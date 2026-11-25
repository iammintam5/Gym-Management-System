import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePtBookingDto {
  @ApiPropertyOptional({
    description: 'Idempotency key for safe client retries',
    example: 'pt-book-550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description:
      'Expected assigned trainer (optional consistency check; server resolves PT from covering Gym)',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsUUID()
  @IsNotEmpty()
  @IsOptional()
  trainerId?: string;

  @ApiProperty({
    description: 'Session start time (ISO 8601 string)',
    example: '2026-10-02T14:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  startsAt!: string;

  @ApiProperty({
    description: 'Session end time (ISO 8601 string)',
    example: '2026-10-02T15:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  endsAt!: string;

  @ApiPropertyOptional({
    description:
      'Member Profile ID (UUID, required for STAFF or ADMIN booking on behalf of member)',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({
    description:
      'PT Availability slot ID (UUID) if booking from an availability window',
    example: '55555555-5555-5555-5555-555555555555',
  })
  @IsOptional()
  @IsUUID()
  availabilityId?: string;
}
