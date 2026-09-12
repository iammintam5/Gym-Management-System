import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { LoginRequest, RefreshTokenRequest } from '@gym/contracts';
export class LoginDto implements LoginRequest {
  @ApiProperty({ example: 'member@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
export class RefreshTokenDto implements RefreshTokenRequest {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken!: string;
}
