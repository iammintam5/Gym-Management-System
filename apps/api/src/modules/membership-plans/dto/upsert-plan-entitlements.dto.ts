import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { PlanEntitlementInputDto } from './plan-entitlement-input.dto';

export class UpsertPlanEntitlementsDto {
  @ApiProperty({
    description: 'Complete list of entitlements to configure for this plan',
    type: [PlanEntitlementInputDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanEntitlementInputDto)
  entitlements!: PlanEntitlementInputDto[];
}
