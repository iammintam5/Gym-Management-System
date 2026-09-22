import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: 'Nguyen Van B', description: 'Updated full name' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName?: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Updated phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'Strength & Conditioning',
    description: 'Updated specialization (string or null)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Specialization must not exceed 100 characters' })
  specialization?: string | null;

  @ApiPropertyOptional({ example: '2024-06-01', description: 'Updated hire date (ISO date or null)' })
  @IsOptional()
  @IsDateString({}, { message: 'Hire date must be a valid ISO date string' })
  hiredAt?: string | null;

  @ApiPropertyOptional({ example: 'updated.staff@gym.local', description: 'Updated email address' })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;
}
