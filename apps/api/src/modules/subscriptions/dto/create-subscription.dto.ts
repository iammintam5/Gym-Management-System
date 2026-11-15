import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaymentStatus } from '@gym/contracts';

export class CreateSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Stable UUID for retries of the same operation',
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  @ApiProperty({
    description: 'Member profile ID (UUID)',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID(undefined, { message: 'memberId must be a valid UUID' })
  @IsNotEmpty()
  memberId!: string;

  @ApiProperty({
    description: 'Membership plan ID (UUID)',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsUUID(undefined, { message: 'planId must be a valid UUID' })
  @IsNotEmpty()
  planId!: string;

  @ApiPropertyOptional({
    description:
      'Subscription start date (ISO string / YYYY-MM-DD). If omitted, starts today (or queues after existing subscription).',
    example: '2026-09-13',
  })
  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid ISO date string' })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Payment method (CASH or TRANSFER)',
    example: 'CASH',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['CASH', 'TRANSFER'])
  paymentMethod?: 'CASH' | 'TRANSFER';

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description:
      'Payment status (defaults to PAID for staff in-person registrations)',
    default: PaymentStatus.PAID,
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    description: 'Optional note or reference for subscription creation',
    example: 'Paid in cash at counter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
