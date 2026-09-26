import { Controller, Get, NotImplementedException, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AttendancePeakHoursReport,
  ClassUtilizationReport,
  DashboardSummaryReport,
  RevenueReportResponse,
  TrainerPerformanceReport,
  UserRole,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { QueryRevenueReportDto } from './dto/query-revenue-report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Foundation RBAC test route',
  })
  @ApiResponse({
    status: 501,
    description: 'Admin authorization is enforced; reporting overview is legacy.',
  })
  overview(): never {
    throw new NotImplementedException('Reports are not implemented.');
  }

  @Get('dashboard-summary')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Executive dashboard overview metrics (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Financial, member, and operational summary KPIs',
  })
  async getDashboardSummary(): Promise<DashboardSummaryReport> {
    return this.reportsService.getDashboardSummary();
  }

  @Get('revenue')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Financial revenue analytics with method and plan breakdowns (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Revenue report by day or month with breakdowns',
  })
  async getRevenueReport(
    @Query() query: QueryRevenueReportDto,
  ): Promise<RevenueReportResponse> {
    return this.reportsService.getRevenueReport(query);
  }

  @Get('attendance-peak-hours')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Hourly check-in attendance distribution and peak hours (Admin & Staff)',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    type: String,
    description: 'Target date (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Hourly check-in counts from 06:00 to 22:00',
  })
  async getAttendancePeakHours(
    @Query('date') date?: string,
  ): Promise<AttendancePeakHoursReport> {
    return this.reportsService.getAttendancePeakHours(date);
  }

  @Get('class-utilization')
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @ApiOperation({
    summary: 'Class schedules capacity utilization rate (Admin & Staff)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'Start date filter',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'End date filter',
  })
  @ApiResponse({
    status: 200,
    description: 'Class utilization rates and booked seat counts',
  })
  async getClassUtilization(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ClassUtilizationReport> {
    return this.reportsService.getClassUtilization(from, to);
  }

  @Get('trainer-performance')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'PT trainer completed sessions and training hours (Admin only)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'Start date filter',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'End date filter',
  })
  @ApiResponse({
    status: 200,
    description: 'Trainer performance statistics',
  })
  async getTrainerPerformance(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<TrainerPerformanceReport> {
    return this.reportsService.getTrainerPerformance(from, to);
  }
}
