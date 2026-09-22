import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateUserRequest } from '@gym/contracts';

export class UpdateUserDto implements UpdateUserRequest {
  @ApiPropertyOptional({ example: 'user.updated@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: 'Nguyen Van B' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  fullName?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone?: string;
}
