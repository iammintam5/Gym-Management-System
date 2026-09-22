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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  UserRole,
  type AuthUser,
  type PaginatedUsersResponse,
  type UserResponse,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List users with pagination, search, filter and sorting (ADMIN only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated user list',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (Requires ADMIN)' })
  async findAll(@Query() query: QueryUsersDto): Promise<PaginatedUsersResponse> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user details by ID (ADMIN only)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponse> {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user account information (ADMIN only)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Email conflict' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(id, body);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate or deactivate/lock user account (ADMIN only)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User status updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot deactivate self or last active admin',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserResponse> {
    return this.usersService.updateStatus(id, body, currentUser.id);
  }

  @Patch(':id/roles')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Assign or update roles for user (ADMIN only)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User roles updated' })
  @ApiResponse({ status: 400, description: 'Invalid role' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot remove ADMIN role from self or last active admin',
  })
  async updateRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserRolesDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserResponse> {
    return this.usersService.updateRoles(id, body, currentUser.id);
  }

  @Post(':id/change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password for authenticated user (Self only)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password incorrect' })
  @ApiResponse({ status: 403, description: 'Forbidden (Not own account)' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async changePassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangePasswordDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    return this.usersService.changePassword(id, body, currentUser.id);
  }
}
