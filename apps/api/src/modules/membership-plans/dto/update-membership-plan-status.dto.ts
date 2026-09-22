import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateMembershipPlanStatusDto {
  @ApiProperty({
    description: 'Whether the plan is active for purchasing',
    example: false,
  })
  @IsBoolean()
  isActive!: boolean;
}
