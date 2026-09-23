import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCheckinDto {
  @ApiPropertyOptional({
    description: 'Member profile ID (UUID)',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'memberId must be a valid UUID' })
  memberId?: string;

  @ApiPropertyOptional({
    description: 'Member code printed on membership card or QR code',
    example: 'MEM-0EFEAC9B',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  memberCode?: string;

  @ApiPropertyOptional({
    description: 'Gate or device identifier (e.g. TURNSTILE_GATE_1)',
    example: 'TURNSTILE_GATE_1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gateIdentifier?: string;
}
