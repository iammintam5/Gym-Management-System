import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthUser,
  PtAvailabilityDetail,
  TrainerSummary,
  UserRole,
} from '@gym/contracts';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrainersService } from './trainers.service';
import { CreatePtAvailabilityDto } from './dto/create-pt-availability.dto';
import { QueryPtAvailabilitiesDto } from './dto/query-pt-availabilities.dto';

@ApiTags('Trainers')
@Controller('trainers')
export class TrainersController {
  constructor(private readonly trainersService: TrainersService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List all active Personal Trainers',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active personal trainers',
  })
  async findAllTrainers(): Promise<TrainerSummary[]> {
    return this.trainersService.findAllActiveTrainers();
  }

  @Post('me/availabilities')
  @Roles(UserRole.PT)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Personal Trainer registers a new availability slot',
  })
  @ApiResponse({
    status: 201,
    description: 'Availability slot registered successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Overlapping availability slot already exists',
  })
  async createMyAvailability(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePtAvailabilityDto,
  ): Promise<PtAvailabilityDetail> {
    return this.trainersService.createAvailability(user.id, dto);
  }

  @Get(':trainerId/availabilities')
  @Public()
  @ApiOperation({
    summary: 'View public available slots of a specific trainer',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active availability slots',
  })
  async getTrainerAvailabilities(
    @Param('trainerId', ParseUUIDPipe) trainerId: string,
    @Query() query: QueryPtAvailabilitiesDto,
  ): Promise<PtAvailabilityDetail[]> {
    return this.trainersService.findTrainerAvailabilities(trainerId, query);
  }

  @Delete('me/availabilities/:id')
  @Roles(UserRole.PT, UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel or delete an availability slot (guarded against active bookings)',
  })
  @ApiResponse({
    status: 200,
    description: 'Availability slot deleted successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete availability slot with active booking',
  })
  async deleteMyAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.trainersService.deleteAvailability(user.id, user.roles, id);
  }

  @Delete('availabilities/:id')
  @Roles(UserRole.PT, UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an availability slot (Alias)',
  })
  async deleteAvailabilityAlias(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.trainersService.deleteAvailability(user.id, user.roles, id);
  }
}
