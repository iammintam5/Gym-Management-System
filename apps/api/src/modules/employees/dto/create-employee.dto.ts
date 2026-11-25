import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { GYM_DOMAIN_RULES, UserRole } from '@gym/contracts';

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
    enum: [UserRole.STAFF, UserRole.TRAINER],
    example: UserRole.STAFF,
    description: 'Employee role (STAFF or TRAINER only; ADMIN/MEMBER are forbidden)',
  })
  @IsIn([UserRole.STAFF, UserRole.TRAINER], {
    message: 'Role must be either STAFF or TRAINER',
  })
  role!: UserRole.STAFF | UserRole.TRAINER;

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
    description: 'Legacy specialization or area of expertise (compatible with older callers)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH, {
    message: `Specialization must not exceed ${GYM_DOMAIN_RULES.EMPLOYEE.SPECIALIZATION_MAX_LENGTH} characters`,
  })
  specialization?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Boxing', 'HIIT'],
    description: 'Structured trainer specialties list (TRAINER role only)',
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

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this trainer can be assigned to group classes (TRAINER role only)',
  })
  @ValidateIf((_obj: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'canTeachClasses must be a boolean' })
  canTeachClasses?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether this trainer can coach 1-on-1 PT sessions (TRAINER role only)',
  })
  @ValidateIf((_obj: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'canCoachPt must be a boolean' })
  canCoachPt?: boolean;

  @ApiPropertyOptional({ example: '2024-06-01', description: 'Hire date in YYYY-MM-DD format' })
  @IsOptional()
  @IsDateString({}, { message: 'Hire date must be a valid ISO date string' })
  hiredAt?: string;
}
