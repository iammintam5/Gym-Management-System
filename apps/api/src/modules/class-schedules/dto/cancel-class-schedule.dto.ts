import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelClassScheduleDto {
  @ApiPropertyOptional({
    description: 'Reason for cancelling the class schedule',
    example: 'HLV bị ốm đột xuất, trung tâm huỷ ca dạy và hoàn lượt cho học viên',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
