import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Gender } from '@gym/contracts';

export class UpdateMemberDto {
  @ApiPropertyOptional({
    example: 'Nguyen Van A',
    description: 'Updated full name',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName?: string;

  @ApiPropertyOptional({
    example: '0901234567',
    description: 'Updated phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
  phone?: string;

  @ApiPropertyOptional({
    enum: Gender,
    example: Gender.MALE,
    description: 'Updated gender (MALE, FEMALE, OTHER, or null)',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({
    example: '1995-05-20',
    description: 'Updated date of birth (ISO date or null)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'Date of birth must be a valid ISO date string' },
  )
  dateOfBirth?: string | null;

  @ApiPropertyOptional({
    example: 'updated.member@gym.local',
    description: 'Updated email address',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  @ApiPropertyOptional({
    example: 'https://storage.gym.local/photos/mem-123.jpg',
    description: 'Updated member ID photo URL or base64 data URL',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200000, { message: 'Photo URL or data URI is too large' })
  idPhotoUrl?: string | null;
}
