import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ServiceTypeCode,
  type MembershipPlanDetail,
  type PaginatedMembershipPlansResponse,
  type PlanEntitlementItem,
  type ServiceTypeItem,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { PtCreditService } from '../pt-packages/pt-credit.service';
import type { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import type { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import type { UpdateMembershipPlanStatusDto } from './dto/update-membership-plan-status.dto';
import type { UpsertPlanEntitlementsDto } from './dto/upsert-plan-entitlements.dto';
import type { QueryMembershipPlansDto } from './dto/query-membership-plans.dto';
import type { PlanEntitlementInputDto } from './dto/plan-entitlement-input.dto';

interface RawPlanWithEntitlements {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  price: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  entitlements: Array<{
    id: string;
    allocated: number | null;
    serviceType: {
      id: string;
      code: string;
      name: string;
    };
  }>;
}

@Injectable()
export class MembershipPlansService {
  private readonly logger = new Logger(MembershipPlansService.name);
  private readonly ptCredits: PtCreditService;

  constructor(
    private readonly db: DatabaseService,
    @Optional() ptCreditService?: PtCreditService,
  ) {
    this.ptCredits = ptCreditService ?? new PtCreditService(this.db);
  }

  private mapPlanDetail(
    plan: RawPlanWithEntitlements,
    _cutoverActive = false,
  ): MembershipPlanDetail {
    const priceNum =
      typeof plan.price === 'number'
        ? plan.price
        : Number(plan.price?.toString() ?? 0);

    const entitlements: PlanEntitlementItem[] = (plan.entitlements || [])
      .filter((e) => e.serviceType.code !== ServiceTypeCode.PT)
      .map((e) => ({
        id: e.id,
        service: e.serviceType.code,
        serviceName: e.serviceType.name,
        limitType: e.allocated === null ? 'UNLIMITED' : 'COUNT',
        limitValue: e.allocated,
      }));

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description ?? null,
      durationDays: plan.durationDays,
      price: priceNum,
      isActive: plan.isActive,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      entitlements,
    };
  }

  private validateEntitlementItem(item: PlanEntitlementInputDto) {
    if (
      !item.service ||
      typeof item.service !== 'string' ||
      !item.service.trim()
    ) {
      throw new BadRequestException('Service code is required');
    }

    if (item.limitType === 'COUNT') {
      if (
        item.limitValue === null ||
        item.limitValue === undefined ||
        typeof item.limitValue !== 'number' ||
        item.limitValue <= 0 ||
        !Number.isInteger(item.limitValue)
      ) {
        throw new BadRequestException(
          `COUNT limit type requires limitValue to be an integer > 0 for service "${item.service}"`,
        );
      }
    } else if (item.limitType === 'UNLIMITED') {
      if (item.limitValue !== null && item.limitValue !== undefined) {
        throw new BadRequestException(
          `UNLIMITED limit type cannot have a limitValue for service "${item.service}"`,
        );
      }
    } else if (item.limitType === 'NONE') {
      if (item.limitValue !== null && item.limitValue !== undefined) {
        throw new BadRequestException(
          `NONE limit type cannot have a limitValue for service "${item.service}"`,
        );
      }
    } else {
      throw new BadRequestException(`Invalid limitType "${item.limitType}"`);
    }
  }

  private async validateAndResolveEntitlements(
    entitlements: PlanEntitlementInputDto[],
    cutoverActive = false,
  ): Promise<
    Array<{ code: string; serviceTypeId: string; allocated: number | null }>
  > {
    const seenServices = new Set<string>();

    for (const item of entitlements) {
      const normalizedCode = item.service.trim().toUpperCase();
      if (seenServices.has(normalizedCode)) {
        throw new BadRequestException(
          `Duplicate service entitlement found for "${normalizedCode}"`,
        );
      }
      seenServices.add(normalizedCode);
      this.validateEntitlementItem(item);
      if (
        cutoverActive &&
        normalizedCode === ServiceTypeCode.PT &&
        item.limitType !== 'NONE'
      ) {
        throw new BadRequestException(
          'Gói tập Gym không còn đính kèm buổi PT 1-1 sau khi tách gói PT bán rời.',
        );
      }
    }

    // Fetch all available service types in database
    const serviceCodes = Array.from(seenServices);
    const existingServices = await this.db.client.serviceType.findMany({
      where: {
        code: { in: serviceCodes },
      },
    });

    const serviceMap = new Map(existingServices.map((s) => [s.code, s.id]));

    for (const code of serviceCodes) {
      if (!serviceMap.has(code)) {
        throw new BadRequestException(`Unknown service type: "${code}"`);
      }
    }

    // Prepare records for database insertion (excluding NONE)
    const result: Array<{
      code: string;
      serviceTypeId: string;
      allocated: number | null;
    }> = [];
    for (const item of entitlements) {
      const code = item.service.trim().toUpperCase();
      const serviceTypeId = serviceMap.get(code)!;
      if (item.limitType === 'NONE') {
        // NONE = do not store entitlement in plan_entitlements
        continue;
      }
      result.push({
        code,
        serviceTypeId,
        allocated: item.limitType === 'UNLIMITED' ? null : item.limitValue!,
      });
    }

    return result;
  }

  async getServiceTypes(): Promise<ServiceTypeItem[]> {
    const [services] = await Promise.all([
      this.db.client.serviceType.findMany({
        orderBy: { code: 'asc' },
      }),
      this.ptCredits.hasCutoverOccurred(),
    ]);
    return services
      .filter((s) => s.code !== ServiceTypeCode.PT)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
      }));
  }

  async create(dto: CreateMembershipPlanDto): Promise<MembershipPlanDetail> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Plan name cannot be empty');
    }
    if (dto.durationDays <= 0) {
      throw new BadRequestException('Duration must be greater than 0');
    }
    if (dto.price < 0) {
      throw new BadRequestException('Price must be greater than or equal to 0');
    }

    const cutoverBeforeTx = await this.ptCredits.hasCutoverOccurred();
    let resolvedEntitlements: Array<{
      code: string;
      serviceTypeId: string;
      allocated: number | null;
    }> = [];

    if (dto.entitlements && dto.entitlements.length > 0) {
      resolvedEntitlements = await this.validateAndResolveEntitlements(
        dto.entitlements,
        cutoverBeforeTx,
      );
    }

    // Atomic transaction to create plan + entitlements
    const { createdPlan, cutoverActive } = await this.db.client.$transaction(
      async (tx) => {
        const cutoverInTx = await this.ptCredits.hasCutoverOccurredInTx(tx);
        if (
          cutoverInTx &&
          resolvedEntitlements.some((e) => e.code === ServiceTypeCode.PT)
        ) {
          throw new BadRequestException(
            'Gói tập Gym không còn đính kèm buổi PT 1-1 sau khi tách gói PT bán rời.',
          );
        }

        const plan = await tx.membershipPlan.create({
          data: {
            name,
            description: dto.description?.trim() || null,
            durationDays: dto.durationDays,
            price: dto.price,
            isActive: dto.isActive ?? true,
          },
        });

        if (resolvedEntitlements.length > 0) {
          await tx.planEntitlement.createMany({
            data: resolvedEntitlements.map((e) => ({
              planId: plan.id,
              serviceTypeId: e.serviceTypeId,
              allocated: e.allocated,
            })),
          });
        }

        const loaded = await tx.membershipPlan.findUniqueOrThrow({
          where: { id: plan.id },
          include: {
            entitlements: {
              include: {
                serviceType: true,
              },
            },
          },
        });
        return { createdPlan: loaded, cutoverActive: cutoverInTx };
      },
    );

    this.logger.log(
      `Created membership plan "${createdPlan.name}" (${createdPlan.id})`,
    );
    return this.mapPlanDetail(
      createdPlan as unknown as RawPlanWithEntitlements,
      cutoverActive,
    );
  }

  async findAll(
    query: QueryMembershipPlansDto,
  ): Promise<PaginatedMembershipPlansResponse> {
    const {
      page = 1,
      limit = 20,
      search,
      isActive,
      service,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const cutoverActive = await this.ptCredits.hasCutoverOccurred();
    if (
      cutoverActive &&
      service &&
      service.trim().toUpperCase() === ServiceTypeCode.PT
    ) {
      return {
        data: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search && search.trim()) {
      const trimmed = search.trim();
      where.OR = [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { description: { contains: trimmed, mode: 'insensitive' } },
      ];
    }

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (service && service.trim()) {
      where.entitlements = {
        some: {
          serviceType: {
            code: { equals: service.trim().toUpperCase(), mode: 'insensitive' },
          },
        },
      };
    }

    const [total, plans] = await Promise.all([
      this.db.client.membershipPlan.count({ where }),
      this.db.client.membershipPlan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      }),
    ]);

    return {
      data: (plans as unknown as RawPlanWithEntitlements[]).map((p) =>
        this.mapPlanDetail(p, cutoverActive),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  async findPublic(): Promise<MembershipPlanDetail[]> {
    const [plans, cutoverActive] = await Promise.all([
      this.db.client.membershipPlan.findMany({
        where: { isActive: true },
        orderBy: [{ price: 'asc' }, { createdAt: 'desc' }],
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      }),
      this.ptCredits.hasCutoverOccurred(),
    ]);

    return (plans as unknown as RawPlanWithEntitlements[]).map((p) =>
      this.mapPlanDetail(p, cutoverActive),
    );
  }

  async findById(id: string): Promise<MembershipPlanDetail> {
    const [plan, cutoverActive] = await Promise.all([
      this.db.client.membershipPlan.findUnique({
        where: { id },
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      }),
      this.ptCredits.hasCutoverOccurred(),
    ]);

    if (!plan) {
      throw new NotFoundException(`Membership plan with ID "${id}" not found`);
    }

    return this.mapPlanDetail(
      plan as unknown as RawPlanWithEntitlements,
      cutoverActive,
    );
  }

  async update(
    id: string,
    dto: UpdateMembershipPlanDto,
  ): Promise<MembershipPlanDetail> {
    const existing = await this.db.client.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Membership plan with ID "${id}" not found`);
    }

    const data: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Plan name cannot be empty');
      }
      data.name = name;
    }

    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }

    if (dto.durationDays !== undefined) {
      if (dto.durationDays <= 0) {
        throw new BadRequestException('Duration must be greater than 0');
      }
      data.durationDays = dto.durationDays;
    }

    if (dto.price !== undefined) {
      if (dto.price < 0) {
        throw new BadRequestException(
          'Price must be greater than or equal to 0',
        );
      }
      data.price = dto.price;
    }

    const [updated, cutoverActive] = await Promise.all([
      this.db.client.membershipPlan.update({
        where: { id },
        data,
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      }),
      this.ptCredits.hasCutoverOccurred(),
    ]);

    this.logger.log(
      `Updated membership plan "${updated.name}" (${updated.id})`,
    );
    return this.mapPlanDetail(
      updated as unknown as RawPlanWithEntitlements,
      cutoverActive,
    );
  }

  async updateStatus(
    id: string,
    dto: UpdateMembershipPlanStatusDto,
  ): Promise<MembershipPlanDetail> {
    const existing = await this.db.client.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Membership plan with ID "${id}" not found`);
    }

    const [updated, cutoverActive] = await Promise.all([
      this.db.client.membershipPlan.update({
        where: { id },
        data: {
          isActive: dto.isActive,
        },
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      }),
      this.ptCredits.hasCutoverOccurred(),
    ]);

    this.logger.log(
      `Updated membership plan status "${updated.name}" (${updated.id}) to isActive=${updated.isActive}`,
    );
    return this.mapPlanDetail(
      updated as unknown as RawPlanWithEntitlements,
      cutoverActive,
    );
  }

  async updateEntitlements(
    id: string,
    dto: UpsertPlanEntitlementsDto,
  ): Promise<MembershipPlanDetail> {
    const existing = await this.db.client.membershipPlan.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Membership plan with ID "${id}" not found`);
    }

    const cutoverBeforeTx = await this.ptCredits.hasCutoverOccurred();
    const resolvedEntitlements = await this.validateAndResolveEntitlements(
      dto.entitlements,
      cutoverBeforeTx,
    );

    // Atomic replacement of entitlements
    const { updatedPlan, cutoverActive } = await this.db.client.$transaction(
      async (tx) => {
        const cutoverInTx = await this.ptCredits.hasCutoverOccurredInTx(tx);
        if (
          cutoverInTx &&
          resolvedEntitlements.some((e) => e.code === ServiceTypeCode.PT)
        ) {
          throw new BadRequestException(
            'Gói tập Gym không còn đính kèm buổi PT 1-1 sau khi tách gói PT bán rời.',
          );
        }

        // 1. Delete existing entitlements for this plan
        await tx.planEntitlement.deleteMany({
          where: { planId: id },
        });

        // 2. Create new non-NONE entitlements
        if (resolvedEntitlements.length > 0) {
          await tx.planEntitlement.createMany({
            data: resolvedEntitlements.map((e) => ({
              planId: id,
              serviceTypeId: e.serviceTypeId,
              allocated: e.allocated,
            })),
          });
        }

        const loaded = await tx.membershipPlan.findUniqueOrThrow({
          where: { id },
          include: {
            entitlements: {
              include: {
                serviceType: true,
              },
            },
          },
        });
        return { updatedPlan: loaded, cutoverActive: cutoverInTx };
      },
    );

    this.logger.log(
      `Updated entitlements for membership plan "${updatedPlan.name}" (${updatedPlan.id})`,
    );
    return this.mapPlanDetail(
      updatedPlan as unknown as RawPlanWithEntitlements,
      cutoverActive,
    );
  }
}
