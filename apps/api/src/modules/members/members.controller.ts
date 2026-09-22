import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  UserRole,
  type AuthUser,
  type MemberDetail,
  type PaginatedMembersResponse,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateMemberSelfDto } from './dto/update-member-self.dto';
import { QueryMembersDto } from './dto/query-members.dto';

@ApiTags('members')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Create a new member (Admin & Staff only)',
    description:
      'Creates a user account, assigns the MEMBER role, and creates a member profile atomically.',
  })
  @ApiOkResponse({ description: 'Member successfully created' })
  @ApiConflictResponse({ description: 'Email or phone already in use' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async create(@Body() dto: CreateMemberDto): Promise<MemberDetail> {
    return this.membersService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'List members with pagination, search, filter and sorting (Admin & Staff only)',
  })
  @ApiOkResponse({ description: 'Paginated list of members' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findAll(@Query() query: QueryMembersDto): Promise<PaginatedMembersResponse> {
    return this.membersService.findAll(query);
  }

  @Get('me')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Get current member profile (Member self-service)',
  })
  @ApiOkResponse({ description: 'Current member profile' })
  @ApiNotFoundResponse({ description: 'Member profile not found for current user' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMe(@CurrentUser() currentUser: AuthUser): Promise<MemberDetail> {
    return this.membersService.findSelf(currentUser.id);
  }

  @Patch('me')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary: 'Update current member profile (Member self-service)',
    description: 'Allows member to update only allowed profile fields (fullName, phone, dateOfBirth).',
  })
  @ApiOkResponse({ description: 'Member profile successfully updated' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateMe(
    @CurrentUser() currentUser: AuthUser,
    @Body() dto: UpdateMemberSelfDto,
  ): Promise<MemberDetail> {
    return this.membersService.updateSelf(currentUser.id, dto);
  }

  @Get('code/:memberCode')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get member detail by member code (Admin & Staff only)',
  })
  @ApiOkResponse({ description: 'Member detail' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findByCode(@Param('memberCode') memberCode: string): Promise<MemberDetail> {
    return this.membersService.findByMemberCode(memberCode);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get member detail by ID (Admin & Staff only)',
  })
  @ApiOkResponse({ description: 'Member detail' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<MemberDetail> {
    return this.membersService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Update member profile by ID (Admin & Staff only)',
  })
  @ApiOkResponse({ description: 'Member profile successfully updated' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiConflictResponse({ description: 'Email already in use' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin/Staff only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDetail> {
    return this.membersService.update(id, dto);
  }
}
