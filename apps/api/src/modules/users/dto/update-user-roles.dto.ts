import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';
import { UserRole, type UpdateUserRolesRequest } from '@gym/contracts';

export class UpdateUserRolesDto implements UpdateUserRolesRequest {
  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.STAFF],
    description: 'List of roles to assign to the user',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[];
}
