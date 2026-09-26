import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Reason for issuing refund',
    example: 'Hội viên huỷ gói tập trong thời hạn hoàn tiền',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
