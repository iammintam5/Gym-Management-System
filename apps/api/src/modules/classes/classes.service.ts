import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GymClassDetail, PaginatedClassesResponse } from '@gym/contracts';
import { DatabaseService } from '../database/database.module';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';
import { UpdateGymClassStatusDto } from './dto/update-gym-class-status.dto';
import { QueryGymClassesDto } from './dto/query-gym-classes.dto';

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(dto: CreateGymClassDto): Promise<GymClassDetail> {
    const trimmedName = dto.name.trim();

    const existing = await this.db.client.gymClass.findFirst({
      where: {
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Class with name "${trimmedName}" already exists`,
      );
    }

    const created = await this.db.client.gymClass.create({
      data: {
        name: trimmedName,
        description: dto.description?.trim() || null,
        isActive: true,
      },
    });

    this.logger.log(`Created new gym class: ${created.name} (${created.id})`);
    return this.mapGymClassDetail(created);
  }

  async findAll(query: QueryGymClassesDto): Promise<PaginatedClassesResponse> {
    const skip = (query.page - 1) * query.limit;

    const where: {
      isActive?: boolean;
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' };
        description?: { contains: string; mode: 'insensitive' };
      }>;
    } = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.db.client.gymClass.count({ where }),
      this.db.client.gymClass.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
      }),
    ]);

    return {
      data: items.map((item) => this.mapGymClassDetail(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async findById(id: string): Promise<GymClassDetail> {
    const gymClass = await this.db.client.gymClass.findUnique({
      where: { id },
    });

    if (!gymClass) {
      throw new NotFoundException(`Gym class with ID "${id}" not found`);
    }

    return this.mapGymClassDetail(gymClass);
  }

  async update(id: string, dto: UpdateGymClassDto): Promise<GymClassDetail> {
    const existing = await this.findById(id);

    if (dto.name) {
      const trimmedName = dto.name.trim();
      if (trimmedName.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await this.db.client.gymClass.findFirst({
          where: {
            name: { equals: trimmedName, mode: 'insensitive' },
            id: { not: id },
          },
        });
        if (duplicate) {
          throw new ConflictException(
            `Class with name "${trimmedName}" already exists`,
          );
        }
      }
    }

    const updated = await this.db.client.gymClass.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        description:
          dto.description !== undefined ? dto.description.trim() || null : undefined,
      },
    });

    this.logger.log(`Updated gym class: ${updated.name} (${updated.id})`);
    return this.mapGymClassDetail(updated);
  }

  async updateStatus(
    id: string,
    dto: UpdateGymClassStatusDto,
  ): Promise<GymClassDetail> {
    await this.findById(id);

    const updated = await this.db.client.gymClass.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    this.logger.log(
      `Updated gym class status: ${updated.name} (${updated.id}) -> isActive: ${updated.isActive}`,
    );
    return this.mapGymClassDetail(updated);
  }

  private mapGymClassDetail(item: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
  }): GymClassDetail {
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      isActive: item.isActive,
    };
  }
}
