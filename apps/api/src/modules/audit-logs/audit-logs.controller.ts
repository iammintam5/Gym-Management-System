import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaginatedAuditLogsResponse, UserRole } from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Search and query sensitive system audit logs (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of audit records',
  })
  async findAll(
    @Query() query: QueryAuditLogsDto,
  ): Promise<PaginatedAuditLogsResponse> {
    return this.auditLogsService.findAll(query);
  }
}
