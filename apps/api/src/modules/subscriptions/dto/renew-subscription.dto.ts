import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaymentStatus } from '@gym/contracts';

export class RenewSubscriptionDto {
  @ApiPropertyOptional({
    description:
      'Target membership plan ID (UUID). If omitted, reuses the plan from the previous subscription.',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'planId must be a valid UUID' })
  planId?: string;

  @ApiPropertyOptional({
    description: 'Payment method (e.g. CASH, TRANSFER, CARD)',
    example: 'CASH',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentMethod?: string;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Payment status (defaults to PAID)',
    default: PaymentStatus.PAID,
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    description: 'Optional note or reference for renewal',
    example: 'Renewed for 1 additional term at counter',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
