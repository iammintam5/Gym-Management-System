import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGymClassDto {
  @ApiPropertyOptional({
    description: 'Updated name of the gym class',
    example: 'Power Vinyasa Yoga',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated description of the class',
    example: 'Updated description of the yoga course.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
