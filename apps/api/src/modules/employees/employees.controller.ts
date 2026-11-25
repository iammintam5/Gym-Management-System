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
  type EmployeeDetail,
  type PaginatedEmployeesResponse,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeSelfDto } from './dto/update-employee-self.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new employee (Admin only)',
    description:
      'Creates a user account, assigns the STAFF or TRAINER role, and creates an employee profile atomically.',
  })
  @ApiOkResponse({ description: 'Employee successfully created' })
  @ApiConflictResponse({ description: 'Email or phone already in use' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async create(@Body() dto: CreateEmployeeDto): Promise<EmployeeDetail> {
    return this.employeesService.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List employees with pagination, search, filter and sorting (Admin only)',
  })
  @ApiOkResponse({ description: 'Paginated list of employees' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findAll(
    @Query() query: QueryEmployeesDto,
  ): Promise<PaginatedEmployeesResponse> {
    return this.employeesService.findAll(query);
  }

  @Get('me')
  @Roles(UserRole.STAFF, UserRole.TRAINER)
  @ApiOperation({
    summary: 'Get current employee profile (Staff & Trainer self-service)',
  })
  @ApiOkResponse({ description: 'Current employee profile' })
  @ApiNotFoundResponse({ description: 'Employee profile not found for current user' })
  @ApiForbiddenResponse({ description: 'Forbidden (Staff/Trainer only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findMe(@CurrentUser() currentUser: AuthUser): Promise<EmployeeDetail> {
    return this.employeesService.findSelf(currentUser.id);
  }

  @Patch('me')
  @Roles(UserRole.STAFF, UserRole.TRAINER)
  @ApiOperation({
    summary: 'Update current employee profile (Staff & Trainer self-service)',
    description:
      'Allows employee to update only allowed profile fields (fullName, phone, specialization, specialties). Service capabilities remain admin-managed.',
  })
  @ApiOkResponse({ description: 'Employee profile successfully updated' })
  @ApiForbiddenResponse({ description: 'Forbidden (Staff/Trainer only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async updateMe(
    @CurrentUser() currentUser: AuthUser,
    @Body() dto: UpdateEmployeeSelfDto,
  ): Promise<EmployeeDetail> {
    return this.employeesService.updateSelf(currentUser.id, dto);
  }

  @Get('code/:employeeCode')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get employee detail by employee code (Admin only)',
  })
  @ApiOkResponse({ description: 'Employee detail' })
  @ApiNotFoundResponse({ description: 'Employee not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findByCode(
    @Param('employeeCode') employeeCode: string,
  ): Promise<EmployeeDetail> {
    return this.employeesService.findByEmployeeCode(employeeCode);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get employee detail by ID (Admin only)',
  })
  @ApiOkResponse({ description: 'Employee detail' })
  @ApiNotFoundResponse({ description: 'Employee not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployeeDetail> {
    return this.employeesService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update employee profile by ID (Admin only)',
  })
  @ApiOkResponse({ description: 'Employee profile successfully updated' })
  @ApiNotFoundResponse({ description: 'Employee not found' })
  @ApiConflictResponse({ description: 'Email already in use' })
  @ApiForbiddenResponse({ description: 'Forbidden (Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeDetail> {
    return this.employeesService.update(id, dto);
  }
}
