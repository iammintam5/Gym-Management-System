import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GymClassDetail, PaginatedClassesResponse, UserRole } from '@gym/contracts';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClassesService } from './classes.service';
import { CreateGymClassDto } from './dto/create-gym-class.dto';
import { UpdateGymClassDto } from './dto/update-gym-class.dto';
import { UpdateGymClassStatusDto } from './dto/update-gym-class-status.dto';
import { QueryGymClassesDto } from './dto/query-gym-classes.dto';

@ApiTags('Classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new gym class (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Class created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Class name already exists' })
  async create(@Body() dto: CreateGymClassDto): Promise<GymClassDetail> {
    return this.classesService.create(dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List gym classes with search, filter and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated list of gym classes' })
  async findAll(
    @Query() query: QueryGymClassesDto,
  ): Promise<PaginatedClassesResponse> {
    return this.classesService.findAll(query);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get class details by ID' })
  @ApiResponse({ status: 200, description: 'Gym class detail' })
  @ApiResponse({ status: 404, description: 'Gym class not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GymClassDetail> {
    return this.classesService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update class name and description (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Class updated successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @ApiResponse({ status: 409, description: 'Class name collision' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGymClassDto,
  ): Promise<GymClassDetail> {
    return this.classesService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate or deactivate a gym class (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Class status updated' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGymClassStatusDto,
  ): Promise<GymClassDetail> {
    return this.classesService.updateStatus(id, dto);
  }
}
