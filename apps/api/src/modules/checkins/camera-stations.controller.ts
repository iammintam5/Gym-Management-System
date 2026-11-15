import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Query,
  Post,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  UserRole,
  type AuthUser,
  type CameraStationState,
  type CheckinDetail,
  type CameraRosterMember,
  type CameraMemberPhoto,
} from '@gym/contracts';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DatabaseService } from '../database/database.module';
import { validateCameraPortrait } from '../common/member-photo';
import { CheckinsService } from './checkins.service';
import { CameraStationsService } from './camera-stations.service';
import {
  CameraCheckinDto,
  CameraStationParamsDto,
  CameraStationReadQueryDto,
} from './dto/camera-checkin.dto';

@ApiTags('Camera stations')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.STAFF)
@Controller('checkins/camera')
export class CameraStationsController {
  constructor(
    private readonly checkins: CheckinsService,
    private readonly stations: CameraStationsService,
    private readonly db: DatabaseService,
  ) {}

  @Get('members')
  @Header('Cache-Control', 'no-store')
  async roster(): Promise<CameraRosterMember[]> {
    const members = await this.db.client.memberProfile.findMany({
      where: { user: { isActive: true }, facePhotoVersion: { not: null } },
      select: { id: true, fullName: true, facePhotoVersion: true },
      orderBy: { id: 'asc' },
    });
    return members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      photoVersion: member.facePhotoVersion!,
    }));
  }

  @Get('members/:memberId/photo')
  @Header('Cache-Control', 'no-store')
  async photo(
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<CameraMemberPhoto> {
    const member = await this.db.client.memberProfile.findFirst({
      where: { id: memberId, user: { isActive: true } },
      select: {
        id: true,
        fullName: true,
        idPhotoUrl: true,
        facePhotoVersion: true,
      },
    });
    if (!member?.idPhotoUrl || !member.facePhotoVersion)
      throw new NotFoundException('Ảnh hội viên không còn khả dụng.');
    return {
      id: member.id,
      fullName: member.fullName,
      photoVersion: member.facePhotoVersion,
      idPhotoUrl: member.idPhotoUrl,
    };
  }

  @Get(':stationId')
  @Header('Cache-Control', 'no-store')
  read(
    @Param() params: CameraStationParamsDto,
    @Query() query: CameraStationReadQueryDto,
  ): CameraStationState {
    const state = this.stations.read(params.stationId);
    return state.latest && state.latest.checkin.id === query.after
      ? { ...state, latest: null, latestUnchanged: true }
      : state;
  }

  @Post(':stationId/heartbeat')
  @HttpCode(200)
  heartbeat(@Param() params: CameraStationParamsDto): CameraStationState {
    const state = this.stations.heartbeat(params.stationId);
    return { ...state, latest: null };
  }

  @Post()
  @HttpCode(200)
  async checkin(
    @Body() dto: CameraCheckinDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CheckinDetail> {
    await validateCameraPortrait(dto.capturedPhoto);
    // The existing service remains responsible for payment, subscription, quota and access checks.
    const result = await this.checkins.recordCheckin(
      {
        memberId: dto.memberId,
        gateIdentifier: dto.stationId,
        idempotencyKey: dto.idempotencyKey,
        photoVersion: dto.photoVersion,
      },
      user.id,
    );
    this.stations.publish(dto.stationId, result, dto.capturedPhoto);
    return result;
  }
}
