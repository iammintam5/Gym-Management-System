import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentStatus } from '@gym/contracts';

export class CreatePaymentDto {
  @ApiProperty({
    description: 'Payment amount',
    example: 1500000,
  })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    description: 'Payment currency (3-letter ISO code)',
    default: 'VND',
    example: 'VND',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string = 'VND';

  @ApiPropertyOptional({
    description: 'Payment method',
    enum: ['CASH', 'TRANSFER', 'CARD'],
    example: 'TRANSFER',
  })
  @IsOptional()
  @IsEnum(['CASH', 'TRANSFER', 'CARD'])
  method?: 'CASH' | 'TRANSFER' | 'CARD';

  @ApiPropertyOptional({
    description: 'Payment status',
    enum: [PaymentStatus.PENDING, PaymentStatus.PAID],
    default: PaymentStatus.PENDING,
    example: PaymentStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus = PaymentStatus.PENDING;

  @ApiPropertyOptional({
    description: 'Cashier note or memo',
    example: 'Thanh toán tiền mặt đợt 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
