import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { AttendanceStatus } from '@gym/contracts';

export class MarkPtAttendanceDto {
  @ApiProperty({
    description: 'Attendance outcome',
    enum: [AttendanceStatus.PRESENT, AttendanceStatus.ABSENT],
    example: AttendanceStatus.PRESENT,
  })
  @IsEnum(AttendanceStatus, {
    message: 'attendance must be either PRESENT or ABSENT',
  })
  @IsNotEmpty()
  attendance!: AttendanceStatus.PRESENT | AttendanceStatus.ABSENT;
}
