import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreatePtBookingDto {
  @ApiProperty({
    description: 'Trainer Employee ID (UUID)',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsUUID()
  @IsNotEmpty()
  trainerId!: string;

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
    description: 'Member Profile ID (UUID, required for STAFF or ADMIN booking on behalf of member)',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiPropertyOptional({
    description: 'PT Availability slot ID (UUID) if booking from an availability window',
    example: '55555555-5555-5555-5555-555555555555',
  })
  @IsOptional()
  @IsUUID()
  availabilityId?: string;
}
