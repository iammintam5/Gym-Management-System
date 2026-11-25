import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, type AuthUser } from '@gym/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AssignedMembersQueryDto,
  AssignedPtSlotsQueryDto,
  AssignPtTrainerDto,
} from './assignment.dto';
import { PtAssignmentsService } from './pt-assignments.service';

@ApiTags('PT Assignments')
@ApiBearerAuth()
@Controller('pt-assignments')
export class PtAssignmentsController {
  constructor(private readonly assignments: PtAssignmentsService) {}

  @Get('me')
  @Roles(UserRole.MEMBER)
  async self(@CurrentUser() user: AuthUser) {
    return this.assignments.list(await this.assignments.memberId(user));
  }

  @Get('members/:memberId')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  member(@Param('memberId', ParseUUIDPipe) id: string) {
    return this.assignments.list(id);
  }

  @Get('trainer')
  @Roles(UserRole.TRAINER)
  trainer(
    @CurrentUser() user: AuthUser,
    @Query() query: AssignedMembersQueryDto,
  ) {
    return this.assignments.trainerMembers(user, query);
  }

  @Get('slots')
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  slots(
    @CurrentUser() user: AuthUser,
    @Query() query: AssignedPtSlotsQueryDto,
  ) {
    return this.assignments.slots(user, query);
  }

  @Post(':subscriptionId')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  assign(
    @Param('subscriptionId', ParseUUIDPipe) id: string,
    @Body() dto: AssignPtTrainerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.assign(id, dto, user);
  }
}
