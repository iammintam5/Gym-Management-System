import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PT_PACKAGE_PLANS,
  PT_PACKAGE_SAMPLE_CODES,
  type DefaultPtPackageCode,
  type PtCatalogInitializationResult,
  type PtPackagePlanDetail,
} from '@gym/contracts';
import { Prisma } from '@gym/database';
import { DatabaseService } from '../database/database.module';

export function mapPlanDetail(plan: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sessionCount: number;
  sessionMinutes: number;
  price: Prisma.Decimal;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PtPackagePlanDetail {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    sessionCount: plan.sessionCount,
    sessionMinutes: plan.sessionMinutes,
    price: Number(plan.price),
    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

@Injectable()
export class PtCatalogInitializerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Explicitly initializes the sample standalone PT catalog (PT1/PT5/PT10/PT20).
   * Preserves any existing catalog rows and admin edits; never invoked on seed/migrations.
   */
  async initializeDefaultPlans(
    options: {
      dryRun?: boolean;
      actorId?: string | null;
    } = {},
  ): Promise<PtCatalogInitializationResult> {
    const dryRun = options.dryRun ?? false;

    return this.db.client.$transaction(async (tx) => {
      if (dryRun) {
        await tx.$executeRawUnsafe(
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        );
      } else {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('gym-pt-catalog-init', 0))::text`;
      }

      const existing = await tx.ptPackagePlan.findMany({
        where: { code: { in: [...PT_PACKAGE_SAMPLE_CODES] } },
        orderBy: [{ sessionCount: 'asc' }, { code: 'asc' }],
      });

      const existingByCode = new Map(
        existing.map((plan) => [plan.code as DefaultPtPackageCode, plan]),
      );

      const existingCodes: DefaultPtPackageCode[] = [];
      const createdCodes: DefaultPtPackageCode[] = [];

      for (const spec of DEFAULT_PT_PACKAGE_PLANS) {
        if (existingByCode.has(spec.code)) {
          existingCodes.push(spec.code);
        } else {
          createdCodes.push(spec.code);
        }
      }

      if (dryRun) {
        return {
          dryRun: true,
          createdCodes,
          existingCodes,
          plans: existing.map(mapPlanDetail),
        };
      }

      if (createdCodes.length > 0) {
        for (const spec of DEFAULT_PT_PACKAGE_PLANS) {
          if (existingByCode.has(spec.code)) {
            continue;
          }
          await tx.ptPackagePlan.create({
            data: {
              code: spec.code,
              name: spec.name,
              description: spec.description,
              sessionCount: spec.sessionCount,
              sessionMinutes: spec.sessionMinutes,
              price: new Prisma.Decimal(spec.price),
              isActive: true,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: options.actorId ?? null,
            action: 'PT_CATALOG_DEFAULTS_INITIALIZED',
            entityType: 'PT_PACKAGE_PLAN',
            metadata: {
              createdCodes,
              existingCodes,
            } as Prisma.InputJsonValue,
          },
        });
      }

      const persistedPlans = await tx.ptPackagePlan.findMany({
        where: { code: { in: [...PT_PACKAGE_SAMPLE_CODES] } },
        orderBy: [{ sessionCount: 'asc' }, { code: 'asc' }],
      });

      return {
        dryRun: false,
        createdCodes,
        existingCodes,
        plans: persistedPlans.map(mapPlanDetail),
      };
    });
  }
}
