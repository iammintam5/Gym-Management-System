import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.module';
import { AuditLogDetail, PaginatedAuditLogsResponse } from '@gym/contracts';
import { Prisma } from '@gym/database';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

interface RawAuditLog {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor?: {
    email: string;
    employeeProfile?: { fullName: string } | null;
    memberProfile?: { fullName: string } | null;
  } | null;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly db: DatabaseService) {}

  async logAction(params: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogDetail> {
    const record = await this.db.client.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: params.metadata
          ? (params.metadata as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
      include: {
        actor: {
          include: {
            employeeProfile: true,
            memberProfile: true,
          },
        },
      },
    });

    this.logger.log(
      `[AuditLog] ${params.action} on ${params.entityType}:${params.entityId ?? 'none'} by ${params.actorId ?? 'system'}`,
    );

    return this.mapAuditLog(record);
  }

  async findAll(query: QueryAuditLogsDto): Promise<PaginatedAuditLogsResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.actorId) {
      where.actorId = query.actorId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.entityId) {
      where.entityId = query.entityId;
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to);
      }
    }

    const [total, records] = await Promise.all([
      this.db.client.auditLog.count({ where }),
      this.db.client.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          actor: {
            include: {
              employeeProfile: true,
              memberProfile: true,
            },
          },
        },
      }),
    ]);

    return {
      data: (records as RawAuditLog[]).map((r) => this.mapAuditLog(r)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private mapAuditLog(raw: RawAuditLog): AuditLogDetail {
    const actorName =
      raw.actor?.employeeProfile?.fullName ??
      raw.actor?.memberProfile?.fullName ??
      raw.actor?.email ??
      null;

    return {
      id: raw.id,
      actorId: raw.actorId,
      actorName,
      actorEmail: raw.actor?.email ?? null,
      action: raw.action,
      entityType: raw.entityType,
      entityId: raw.entityId,
      metadata: raw.metadata as Record<string, unknown> | null,
      createdAt: raw.createdAt.toISOString(),
    };
  }
}
