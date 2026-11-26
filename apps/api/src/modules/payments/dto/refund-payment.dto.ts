import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { PaymentMethod, RefundPaymentRequest } from '@gym/contracts';

export class RefundPaymentDto implements RefundPaymentRequest {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;

  @ApiProperty({ enum: ['CASH', 'TRANSFER'] })
  @IsIn(['CASH', 'TRANSFER'])
  method!: PaymentMethod;

  @ApiPropertyOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (o: RefundPaymentDto) =>
      o.method === 'TRANSFER' || o.reference !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference?: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  expectedAmount!: number;

  @ApiProperty({ enum: [true] })
  @Equals(true)
  confirmedExternal!: true;
}
