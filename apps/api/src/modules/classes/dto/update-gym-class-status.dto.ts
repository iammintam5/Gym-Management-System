import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateGymClassStatusDto {
  @ApiProperty({
    description: 'Active status of the class',
    example: true,
  })
  @IsBoolean()
  isActive!: boolean;
}
