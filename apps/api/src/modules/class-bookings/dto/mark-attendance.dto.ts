import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkClassAttendanceDto {
  @ApiProperty({
    enum: ['PRESENT', 'ABSENT'],
    description: 'Attendance status for the booked member',
    example: 'PRESENT',
  })
  @IsNotEmpty()
  @IsIn(['PRESENT', 'ABSENT'])
  attendance!: 'PRESENT' | 'ABSENT';

  @ApiPropertyOptional({
    description: 'Optional note from instructor or receptionist',
    example: 'Attended session on time',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
