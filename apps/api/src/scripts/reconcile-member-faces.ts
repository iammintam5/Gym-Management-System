import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient } from '@gym/database';
import type { FaceDescriptorSnapshot } from '@gym/contracts';
import { FaceRecognitionService } from '../modules/face-recognition/face-recognition.service';
import { faceDistance } from '../modules/face-recognition/face-enrollment.service';

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Set DATABASE_URL, then run this script. Default mode reports only. --apply writes verified descriptors and photo fingerprints. Photos and accounts are preserved.',
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be supplied by the caller');
  const config = new ConfigService(process.env);
  const apply = process.argv.includes('--apply');
  const limit = Number(process.env.FACE_REPORT_MAX_MEMBERS ?? 1000);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 20000)
    throw new Error('FACE_REPORT_MAX_MEMBERS must be in [1, 20000]');
  const threshold = Number(process.env.FACE_DUPLICATE_DISTANCE ?? 0.5);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 2)
    throw new Error('Invalid FACE_DUPLICATE_DISTANCE');
  const engine = new FaceRecognitionService(config);
  const db = createPrismaClient(url);
  const prepared: Array<{
    id: string;
    memberCode: string;
    fullName: string;
    sourceHash: string;
    face: FaceDescriptorSnapshot;
  }> = [];
  const invalid: Array<{ memberCode: string; reason: string }> = [];
  const conflicts: Array<{ left: string; right: string }> = [];
  const skipped: string[] = [];
  let updated = 0;
  let cursor: string | undefined;
  try {
    const count = await db.memberProfile.count({
      where: { idPhotoUrl: { not: null } },
    });
    if (count > limit)
      throw new Error(
        `Found ${count} photos, exceeding report budget ${limit}. Raise FACE_REPORT_MAX_MEMBERS explicitly after evaluating CPU cost.`,
      );
    do {
      const page = await db.memberProfile.findMany({
        where: { idPhotoUrl: { not: null } },
        orderBy: { id: 'asc' },
        take: 25,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, fullName: true, idPhotoUrl: true },
      });
      for (const member of page) {
        const memberCode = `MEM-${member.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
        try {
          const result = await engine.prepare(member.idPhotoUrl!);
          const sourceHash = createHash('md5')
            .update(member.idPhotoUrl!)
            .digest('hex');
          const face = {
            descriptor: result.descriptor,
            mirroredDescriptor: result.mirroredDescriptor,
            modelVersion: result.modelVersion,
            photoVersion: sourceHash,
          };
          for (const existing of prepared) {
            if (
              Math.min(
                faceDistance(face.descriptor, existing.face.descriptor),
                faceDistance(face.descriptor, existing.face.mirroredDescriptor),
                faceDistance(face.mirroredDescriptor, existing.face.descriptor),
                faceDistance(
                  face.mirroredDescriptor,
                  existing.face.mirroredDescriptor,
                ),
              ) <= threshold
            ) {
              conflicts.push({ left: existing.memberCode, right: memberCode });
            }
          }
          prepared.push({
            id: member.id,
            memberCode,
            fullName: member.fullName,
            sourceHash,
            face,
          });
        } catch (error) {
          const status =
            error && typeof error === 'object' && 'getStatus' in error
              ? (error as { getStatus(): number }).getStatus()
              : 500;
          invalid.push({
            memberCode,
            reason:
              status === 400
                ? 'Photo does not meet face enrollment requirements. Review or retake at reception.'
                : 'Recognition unavailable or timed out. Retry the report before changing this photo.',
          });
        }
      }
      cursor = page.length === 25 ? page[page.length - 1]!.id : undefined;
    } while (cursor);
    if (apply) {
      for (const item of prepared) {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('member-face-enrollment', 0))::text`;
          const current = await tx.memberProfile.findUnique({
            where: { id: item.id },
            select: { idPhotoUrl: true },
          });
          if (
            !current?.idPhotoUrl ||
            createHash('md5').update(current.idPhotoUrl).digest('hex') !==
              item.sourceHash
          ) {
            skipped.push(item.memberCode);
            return;
          }
          await tx.memberProfile.update({
            where: { id: item.id },
            data: { facePhotoVersion: item.sourceHash },
          });
          await tx.memberFaceDescriptor.upsert({
            where: { memberId: item.id },
            create: { memberId: item.id, ...item.face },
            update: item.face,
          });
          await tx.auditLog.create({
            data: {
              action: 'MEMBER_FACE_INDEXED',
              entityType: 'MEMBER_PHOTO',
              entityId: item.id,
              metadata: {
                photoVersion: item.sourceHash,
                modelVersion: item.face.modelVersion,
              },
            },
          });
          updated++;
        });
      }
    }
    console.log(
      JSON.stringify(
        {
          apply,
          modelVersion: engine.modelVersion,
          threshold,
          thresholdCalibration:
            'provisional; requires real multi-person evaluation',
          scanned: prepared.length + invalid.length,
          valid: prepared.map(({ memberCode, fullName }) => ({
            memberCode,
            fullName,
          })),
          invalid,
          conflicts,
          updated,
          skipped,
        },
        null,
        2,
      ),
    );
  } finally {
    await engine.onModuleDestroy();
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Face report failed');
  process.exitCode = 1;
});
