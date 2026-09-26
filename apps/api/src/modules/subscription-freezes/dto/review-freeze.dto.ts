import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewFreezeDto {
  @ApiPropertyOptional({
    description: 'Reason for rejection or approval note',
    example: 'Không đủ điều kiện theo chính sách phòng tập',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
