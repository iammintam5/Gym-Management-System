import { Controller, Get, NotImplementedException } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
@ApiTags('reports')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('reports')
export class ReportsController {
  @Get('overview')
  @ApiResponse({
    status: 501,
    description:
      'Admin authorization is enforced; reporting is not implemented.',
  })
  overview(): never {
    throw new NotImplementedException('Reports are not implemented.');
  }
}
