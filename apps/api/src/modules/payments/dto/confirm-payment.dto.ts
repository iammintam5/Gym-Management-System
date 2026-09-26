import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({
    description: 'Payment method applied',
    enum: ['CASH', 'TRANSFER', 'CARD'],
    example: 'TRANSFER',
  })
  @IsEnum(['CASH', 'TRANSFER', 'CARD'])
  @IsNotEmpty()
  method!: 'CASH' | 'TRANSFER' | 'CARD';

  @ApiPropertyOptional({
    description: 'Bank transfer reference code or POS transaction authorization number',
    example: 'FT260923888899',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceCode?: string;

  @ApiPropertyOptional({
    description: 'Cashier note or memo',
    example: 'Khách chuyển khoản Vietcombank',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
