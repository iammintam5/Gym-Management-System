import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PtBookingActionDto {
  @ApiPropertyOptional({
    description: 'Idempotency key for safe client retries',
    example: 'pt-action-550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
