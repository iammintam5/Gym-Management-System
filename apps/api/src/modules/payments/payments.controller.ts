import {
  Body,
  Controller,
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
  PaginatedPaymentsResponse,
  PaymentReceipt,
  PaymentReconciliationResponse,
  PaymentRecordDetail,
  UserRole,
} from '@gym/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';

@ApiTags('Payments')
@Controller()
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('subscriptions/:id/payments')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a new payment record for a subscription (Staff/Admin)',
  })
  @ApiResponse({
    status: 201,
    description: 'Payment record created successfully',
  })
  async createSubscriptionPayment(
    @Param('id', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    return this.paymentsService.createPayment(subscriptionId, dto, user);
  }

  @Post('payments/:id/confirm')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm a payment collection (marks PAID, sets cashier, syncs subscription & triggers JIT promotion)',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment confirmed successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict (payment already confirmed or cancelled)',
  })
  async confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    return this.paymentsService.confirmPayment(id, dto, user);
  }

  @Post('payments/:id/refund')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Issue a refund for a payment (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment refunded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (payment is not in PAID status)',
  })
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentRecordDetail> {
    return this.paymentsService.refundPayment(id, dto, user);
  }

  @Get('payments/reconciliation')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Cashier shift / daily revenue reconciliation breakdown',
  })
  @ApiResponse({
    status: 200,
    description:
      'Revenue totals categorized by cash, transfer, card and transaction count',
  })
  async getReconciliation(
    @Query() query: ReconciliationQueryDto,
  ): Promise<PaymentReconciliationResponse> {
    return this.paymentsService.reconcile(query);
  }

  @Get('payments/:id/receipt')
  @Roles(UserRole.MEMBER, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Retrieve digital receipt snapshot (Member owner, Staff or Admin)',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment receipt with unique REC-... number',
  })
  async getReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<PaymentReceipt> {
    return this.paymentsService.getReceipt(id, user);
  }

  @Get('payments')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'List payment transaction records with filters and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of payment records',
  })
  async getPayments(
    @Query() query: QueryPaymentsDto,
  ): Promise<PaginatedPaymentsResponse> {
    return this.paymentsService.findAll(query);
  }

  @Get('payments/me')
  @Roles(UserRole.MEMBER)
  @ApiOperation({ summary: 'Member lists own Gym and PT payments' })
  async getMyPayments(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPaymentsDto,
  ): Promise<PaginatedPaymentsResponse> {
    return this.paymentsService.findSelf(user.id, query);
  }

  @Get('payments/:id')
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get payment record details by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment record detail',
  })
  async getPaymentDetail(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecordDetail> {
    return this.paymentsService.findById(id);
  }
}
