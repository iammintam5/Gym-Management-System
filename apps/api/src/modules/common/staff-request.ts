import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@gym/database';

function requestHash(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
    .filter(([key, value]) => key !== 'idempotencyKey' && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export async function previousStaffRequest(
  tx: Prisma.TransactionClient,
  key: string | undefined,
  operation: string,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  if (!key) return undefined;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  const previous = await tx.staffRequest.findUnique({
    where: { idempotencyKey: key },
  });
  if (!previous) return undefined;
  if (
    previous.operation !== operation ||
    previous.requestHash !== requestHash(payload)
  ) {
    throw new ConflictException(
      'Mã yêu cầu đã được dùng cho dữ liệu khác. Vui lòng kiểm tra giao dịch trước khi tạo yêu cầu mới.',
    );
  }
  return previous.entityId;
}

export async function saveStaffRequest(
  tx: Prisma.TransactionClient,
  key: string | undefined,
  operation: string,
  payload: Record<string, unknown>,
  entityId: string,
): Promise<void> {
  if (!key) return;
  await tx.staffRequest.create({
    data: {
      idempotencyKey: key,
      operation,
      requestHash: requestHash(payload),
      entityId,
    },
  });
}
