import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
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
  type MemberPtCreditBalanceResponse,
} from '@gym/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PtCreditService } from './pt-credit.service';

@ApiTags('PT Packages')
@ApiBearerAuth()
@Controller()
export class PtPackagesController {
  constructor(private readonly ptCreditService: PtCreditService) {}

  @Get('pt-packages/me/credits')
  @Roles(UserRole.MEMBER)
  @ApiOperation({
    summary:
      'Get spendable PT 1-on-1 credit balance and eligible sources for the authenticated member',
  })
  @ApiOkResponse({ description: 'Authenticated member PT credit balance' })
  @ApiNotFoundResponse({ description: 'Member profile not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Member only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMyPtCredits(
    @CurrentUser() user: AuthUser,
  ): Promise<MemberPtCreditBalanceResponse> {
    return this.ptCreditService.getSelfPtCreditBalance(user.id);
  }

  @Get('members/:memberId/pt-credits')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Get spendable PT 1-on-1 credit balance and eligible sources for a specific member (Staff & Admin)',
  })
  @ApiOkResponse({ description: 'Member PT credit balance' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Forbidden (Staff & Admin only)' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMemberPtCredits(
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<MemberPtCreditBalanceResponse> {
    return this.ptCreditService.getMemberPtCreditBalance(memberId);
  }
}
