import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { PaymentMethod, PurchasePtPackageInput } from '@gym/contracts';

export class PurchasePtPackageDto implements PurchasePtPackageInput {
  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  memberId!: string;

  @IsUUID()
  @ApiProperty({ format: 'uuid' })
  ptPlanId!: string;

  @IsUUID()
  @ApiProperty({
    format: 'uuid',
    description: 'Keep the same key for retries of one sale.',
  })
  idempotencyKey!: string;

  @IsIn(['CASH', 'TRANSFER'])
  @ApiProperty({ enum: ['CASH', 'TRANSFER'] })
  paymentMethod!: PaymentMethod;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999999999999)
  @ApiProperty({
    example: 2250000,
    description: 'Catalog price reviewed by the cashier.',
  })
  expectedPrice!: number;

  @IsDateString()
  @ApiProperty({
    format: 'date-time',
    description: 'Catalog version reviewed by the cashier.',
  })
  expectedPlanUpdatedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ApiPropertyOptional({ maxLength: 500 })
  note?: string;
}
