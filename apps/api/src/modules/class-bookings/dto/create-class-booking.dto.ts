import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateClassBookingDto {
  @ApiProperty({
    description: 'Class Schedule ID (UUID)',
    example: '55555555-5555-5555-5555-555555555555',
  })
  @IsUUID()
  @IsNotEmpty()
  scheduleId!: string;

  @ApiPropertyOptional({
    description:
      'Target member ID (Staff booking on behalf of member; omitted for Member self-booking)',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;
}
