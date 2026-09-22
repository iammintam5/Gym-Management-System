import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { UpdateUserStatusRequest } from '@gym/contracts';

export class UpdateUserStatusDto implements UpdateUserStatusRequest {
  @ApiProperty({ example: false, description: 'True to activate, false to deactivate/lock' })
  @IsBoolean()
  isActive!: boolean;
}
