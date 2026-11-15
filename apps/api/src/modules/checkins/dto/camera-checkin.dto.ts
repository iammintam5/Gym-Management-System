import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  IsOptional,
} from 'class-validator';
import {
  CAMERA_STATION_RULES,
  type CameraCheckinRequest,
} from '@gym/contracts';

export class CameraStationParamsDto {
  @ApiProperty({ example: 'front-desk' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,50}$/)
  stationId!: string;
}

export class CameraCheckinDto
  extends CameraStationParamsDto
  implements CameraCheckinRequest
{
  @ApiProperty()
  @IsUUID()
  memberId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{8,100}$/)
  idempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{32}$/)
  photoVersion!: string;

  @ApiProperty({
    description: 'JPEG portrait data URL; transient comparison image only.',
  })
  @IsString()
  @MaxLength(CAMERA_STATION_RULES.maxImageLength)
  @Matches(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
  capturedPhoto!: string;
}

export class CameraStationReadQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  after?: string;
}
