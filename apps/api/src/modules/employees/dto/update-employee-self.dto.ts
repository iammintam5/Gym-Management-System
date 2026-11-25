import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { GYM_DOMAIN_RULES } from '@gym/contracts';

export class UpdateEmployeeSelfDto {
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
  @MaxLength(GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH, {
    message: `Specialization must not exceed ${GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH} characters`,
  })
  specialization?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['Strength & Conditioning', 'Mobility'],
    description: 'Updated structured trainer specialties list',
  })
  @ValidateIf((_obj: unknown, value: unknown) => value !== undefined)
  @IsArray({ message: 'Specialties must be an array of strings' })
  @ArrayMaxSize(GYM_DOMAIN_RULES.EMPLOYEE.MAX_SPECIALTIES, {
    message: `Specialties must not exceed ${GYM_DOMAIN_RULES.EMPLOYEE.MAX_SPECIALTIES} items`,
  })
  @IsString({ each: true, message: 'Each specialty must be a string' })
  @Matches(/\S/, {
    each: true,
    message: 'Each specialty must be a non-empty string',
  })
  @MaxLength(GYM_DOMAIN_RULES.EMPLOYEE.SPECIALTY_MAX_LENGTH, {
    each: true,
    message: `Each specialty must not exceed ${GYM_DOMAIN_RULES.EMPLOYEE.SPECIALTY_MAX_LENGTH} characters`,
  })
  specialties?: string[];
}
