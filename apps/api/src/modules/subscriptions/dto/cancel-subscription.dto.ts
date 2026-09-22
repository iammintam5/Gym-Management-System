import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelSubscriptionDto {
  @ApiProperty({
    description: 'Reason for cancellation',
    example: 'Customer requested cancellation due to relocation',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Cancellation reason is required' })
  @MaxLength(500)
  reason!: string;
}
