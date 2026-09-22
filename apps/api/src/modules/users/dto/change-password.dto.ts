import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordRequest } from '@gym/contracts';

export class ChangePasswordDto implements ChangePasswordRequest {
  @ApiProperty({ example: 'OldPassword@123' })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, example: 'NewSecurePassword@123' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
