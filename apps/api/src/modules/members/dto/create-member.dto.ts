import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Gender } from '@gym/contracts';

export class CreateMemberDto {
  @ApiProperty({
    example: 'member@gym.local',
    description: 'Member account email',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiProperty({ example: 'Nguyen Van A', description: 'Member full name' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MinLength(2, { message: 'Full name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName!: string;

  @ApiPropertyOptional({
    example: 'Member@123456',
    description:
      'Initial password (min 8 characters). Defaults to Member@123456 if omitted.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  password?: string;

  @ApiPropertyOptional({
    example: '0901234567',
    description: 'Member phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
  phone?: string;

  @ApiPropertyOptional({
    enum: Gender,
    example: Gender.MALE,
    description: 'Member gender (MALE, FEMALE, OTHER)',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    example: '1995-05-20',
    description: 'Date of birth in YYYY-MM-DD format',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'Date of birth must be a valid ISO date string' },
  )
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: 'https://storage.gym.local/photos/mem-123.jpg',
    description:
      'Member ID photo URL or base64 data URL (captured at reception desk)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200000, { message: 'Photo URL or data URI is too large' })
  idPhotoUrl?: string;
}
