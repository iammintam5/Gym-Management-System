import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PaymentStatus } from '@gym/contracts';

export class QueryPaymentsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description: 'Items per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter by payment status (PENDING, PAID, REFUNDED, CANCELLED)',
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({
    enum: ['CASH', 'TRANSFER', 'CARD'],
    description: 'Filter by payment method',
  })
  @IsOptional()
  @IsEnum(['CASH', 'TRANSFER', 'CARD'])
  method?: 'CASH' | 'TRANSFER' | 'CARD';

  @ApiPropertyOptional({
    description: 'Filter by Subscription ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @ApiPropertyOptional({
    description: 'Filter by Member ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({
    description: 'Filter by Cashier / Confirmer User ID (UUID)',
  })
  @IsOptional()
  @IsUUID()
  confirmedBy?: string;

  @ApiPropertyOptional({
    description: 'Filter payments created/confirmed from date-time (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter payments created/confirmed until date-time (ISO string)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
