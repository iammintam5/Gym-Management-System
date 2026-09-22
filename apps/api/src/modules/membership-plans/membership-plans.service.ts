import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MembershipPlanDetail,
  PaginatedMembershipPlansResponse,
  PlanEntitlementItem,
  ServiceTypeItem,
} from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
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

  constructor(private readonly db: DatabaseService) {}

  private mapPlanDetail(plan: RawPlanWithEntitlements): MembershipPlanDetail {
    const priceNum =
      typeof plan.price === 'number'
        ? plan.price
        : Number(plan.price?.toString() ?? 0);

    const entitlements: PlanEntitlementItem[] = (plan.entitlements || []).map(
      (e) => ({
        id: e.id,
        service: e.serviceType.code,
        serviceName: e.serviceType.name,
        limitType: e.allocated === null ? 'UNLIMITED' : 'COUNT',
        limitValue: e.allocated,
      }),
    );

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
    if (!item.service || typeof item.service !== 'string' || !item.service.trim()) {
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
  ): Promise<Array<{ serviceTypeId: string; allocated: number | null }>> {
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
    const result: Array<{ serviceTypeId: string; allocated: number | null }> = [];
    for (const item of entitlements) {
      const code = item.service.trim().toUpperCase();
      const serviceTypeId = serviceMap.get(code)!;
      if (item.limitType === 'NONE') {
        // NONE = do not store entitlement in plan_entitlements
        continue;
      }
      result.push({
        serviceTypeId,
        allocated: item.limitType === 'UNLIMITED' ? null : item.limitValue!,
      });
    }

    return result;
  }

  async getServiceTypes(): Promise<ServiceTypeItem[]> {
    const services = await this.db.client.serviceType.findMany({
      orderBy: { code: 'asc' },
    });
    return services.map((s) => ({
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

    let resolvedEntitlements: Array<{
      serviceTypeId: string;
      allocated: number | null;
    }> = [];

    if (dto.entitlements && dto.entitlements.length > 0) {
      resolvedEntitlements = await this.validateAndResolveEntitlements(
        dto.entitlements,
      );
    }

    // Atomic transaction to create plan + entitlements
    const createdPlan = await this.db.client.$transaction(async (tx) => {
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

      return tx.membershipPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      });
    });

    this.logger.log(`Created membership plan "${createdPlan.name}" (${createdPlan.id})`);
    return this.mapPlanDetail(createdPlan as unknown as RawPlanWithEntitlements);
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
        this.mapPlanDetail(p),
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
    const plans = await this.db.client.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: [{ price: 'asc' }, { createdAt: 'desc' }],
      include: {
        entitlements: {
          include: {
            serviceType: true,
          },
        },
      },
    });

    return (plans as unknown as RawPlanWithEntitlements[]).map((p) =>
      this.mapPlanDetail(p),
    );
  }

  async findById(id: string): Promise<MembershipPlanDetail> {
    const plan = await this.db.client.membershipPlan.findUnique({
      where: { id },
      include: {
        entitlements: {
          include: {
            serviceType: true,
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(`Membership plan with ID "${id}" not found`);
    }

    return this.mapPlanDetail(plan as unknown as RawPlanWithEntitlements);
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

    const updated = await this.db.client.membershipPlan.update({
      where: { id },
      data,
      include: {
        entitlements: {
          include: {
            serviceType: true,
          },
        },
      },
    });

    this.logger.log(`Updated membership plan "${updated.name}" (${updated.id})`);
    return this.mapPlanDetail(updated as unknown as RawPlanWithEntitlements);
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

    const updated = await this.db.client.membershipPlan.update({
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
    });

    this.logger.log(
      `Updated membership plan status "${updated.name}" (${updated.id}) to isActive=${updated.isActive}`,
    );
    return this.mapPlanDetail(updated as unknown as RawPlanWithEntitlements);
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

    const resolvedEntitlements = await this.validateAndResolveEntitlements(
      dto.entitlements,
    );

    // Atomic replacement of entitlements
    const updatedPlan = await this.db.client.$transaction(async (tx) => {
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

      return tx.membershipPlan.findUniqueOrThrow({
        where: { id },
        include: {
          entitlements: {
            include: {
              serviceType: true,
            },
          },
        },
      });
    });

    this.logger.log(
      `Updated entitlements for membership plan "${updatedPlan.name}" (${updatedPlan.id})`,
    );
    return this.mapPlanDetail(updatedPlan as unknown as RawPlanWithEntitlements);
  }
}
