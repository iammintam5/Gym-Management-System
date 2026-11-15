import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@gym/database';
import type {
  FaceDescriptorSnapshot,
  MemberFaceConflict,
} from '@gym/contracts';
import { FaceRecognitionService } from './face-recognition.service';

export function faceDistance(left: number[], right: number[]): number {
  if (
    left.length !== 128 ||
    right.length !== 128 ||
    !left.every(Number.isFinite) ||
    !right.every(Number.isFinite)
  ) {
    throw new ServiceUnavailableException(
      'Dữ liệu nhận diện cần được đồng bộ lại.',
    );
  }
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0),
  );
}

@Injectable()
export class FaceEnrollmentService {
  readonly duplicateDistance: number;
  constructor(
    readonly recognizer: FaceRecognitionService,
    config: ConfigService,
  ) {
    this.duplicateDistance = Number(
      config.get<string>('FACE_DUPLICATE_DISTANCE') ?? 0.5,
    );
    if (
      !Number.isFinite(this.duplicateDistance) ||
      this.duplicateDistance <= 0 ||
      this.duplicateDistance > 2
    ) {
      throw new Error('FACE_DUPLICATE_DISTANCE must be in (0, 2]');
    }
  }

  async lock(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('member-face-enrollment', 0))::text`;
  }

  async assertUnique(
    tx: Prisma.TransactionClient,
    face: FaceDescriptorSnapshot,
    excludeMemberId?: string,
  ): Promise<void> {
    const missing = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM member_profiles m
      LEFT JOIN member_face_descriptors d ON d.member_id = m.id
      WHERE m.id_photo_url IS NOT NULL
        AND (${excludeMemberId ?? null}::uuid IS NULL OR m.id <> ${excludeMemberId ?? null}::uuid)
        AND (d.model_version IS DISTINCT FROM ${face.modelVersion} OR d.photo_version IS DISTINCT FROM m.face_photo_version)
    `;
    if (Number(missing[0]?.count ?? 0) > 0) {
      throw new ServiceUnavailableException({
        code: 'FACE_INDEX_NOT_READY',
        message:
          'Ảnh hồ sơ hiện có cần được đồng bộ nhận diện trước khi lưu ảnh mới. Nhờ quản trị viên kiểm tra.',
      });
    }
    const conflicts: MemberFaceConflict[] = [];
    let cursor: string | undefined;
    do {
      const rows = await tx.memberFaceDescriptor.findMany({
        where: {
          modelVersion: face.modelVersion,
          memberId: excludeMemberId ? { not: excludeMemberId } : undefined,
        },
        orderBy: { memberId: 'asc' },
        take: 256,
        ...(cursor ? { cursor: { memberId: cursor }, skip: 1 } : {}),
        include: { member: { select: { id: true, fullName: true } } },
      });
      for (const row of rows) {
        const distance = Math.min(
          faceDistance(face.descriptor, row.descriptor),
          faceDistance(face.descriptor, row.mirroredDescriptor),
          faceDistance(face.mirroredDescriptor, row.descriptor),
          faceDistance(face.mirroredDescriptor, row.mirroredDescriptor),
        );
        if (distance <= this.duplicateDistance) {
          conflicts.push({
            memberId: row.memberId,
            memberCode: `MEM-${row.memberId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
            fullName: row.member.fullName,
          });
        }
      }
      cursor =
        rows.length === 256 ? rows[rows.length - 1]!.memberId : undefined;
    } while (cursor);
    if (conflicts.length) {
      throw new ConflictException({
        code: 'DUPLICATE_MEMBER_FACE',
        message: `Ảnh nghi trùng khuôn mặt với hội viên ${conflicts.map((item) => item.memberCode).join(', ')}. Vui lòng đối chiếu hồ sơ trước khi tiếp tục.`,
        conflicts,
      });
    }
  }

  async save(
    tx: Prisma.TransactionClient,
    memberId: string,
    face: FaceDescriptorSnapshot,
  ): Promise<void> {
    const data = {
      modelVersion: face.modelVersion,
      photoVersion: face.photoVersion,
      descriptor: face.descriptor,
      mirroredDescriptor: face.mirroredDescriptor,
    };
    await tx.memberFaceDescriptor.upsert({
      where: { memberId },
      create: { memberId, ...data },
      update: data,
    });
  }

  async remove(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
    await tx.memberFaceDescriptor.deleteMany({ where: { memberId } });
  }

  async audit(
    tx: Prisma.TransactionClient,
    action: string,
    memberId: string,
    actorId?: string,
    photoVersion?: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entityType: 'MEMBER_PHOTO',
        entityId: memberId,
        metadata: {
          photoVersion: photoVersion ?? null,
          modelVersion: this.recognizer.modelVersion,
        },
      },
    });
  }
}
