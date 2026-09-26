import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGymClassDto {
  @ApiProperty({
    description: 'Name of the gym class',
    example: 'Vinyasa Yoga',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the class',
    example: 'High-energy flowing yoga session focusing on breath and movement.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
