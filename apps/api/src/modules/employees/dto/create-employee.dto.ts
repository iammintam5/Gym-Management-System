import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@gym/contracts';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'staff.member@gym.local', description: 'Employee account email' })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiProperty({ example: 'Nguyen Van B', description: 'Employee full name' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MinLength(2, { message: 'Full name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName!: string;

  @ApiProperty({
    enum: [UserRole.STAFF, UserRole.PT],
    example: UserRole.STAFF,
    description: 'Employee role (STAFF or PT only; ADMIN/MEMBER are forbidden)',
  })
  @IsIn([UserRole.STAFF, UserRole.PT], {
    message: 'Role must be either STAFF or PT',
  })
  role!: UserRole.STAFF | UserRole.PT;

  @ApiPropertyOptional({
    example: 'Staff@123456',
    description: 'Initial password (min 8 characters). Defaults based on role if omitted.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  password?: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Employee phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'Customer Service & Reception',
    description: 'Specialization or area of expertise (e.g. Strength Training for PT)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Specialization must not exceed 100 characters' })
  specialization?: string;

  @ApiPropertyOptional({ example: '2024-06-01', description: 'Hire date in YYYY-MM-DD format' })
  @IsOptional()
  @IsDateString({}, { message: 'Hire date must be a valid ISO date string' })
  hiredAt?: string;
}
