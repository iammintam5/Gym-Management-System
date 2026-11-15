import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  CAMERA_STATION_RULES,
  type CameraStationEvent,
  type CameraStationState,
  type CheckinDetail,
} from '@gym/contracts';

interface StationEntry {
  lastSeenAt: number;
  latest: CameraStationEvent | null;
}

/** Single API instance, bounded transient transport; no biometric image is persisted. */
@Injectable()
export class CameraStationsService implements OnModuleDestroy {
  private readonly cleanupTimer = setInterval(
    () => this.cleanup(Date.now()),
    10000,
  ).unref();
  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    this.stations.clear();
  }
  private readonly stations = new Map<string, StationEntry>();

  private cleanup(now: number): void {
    for (const [id, station] of this.stations) {
      if (now - station.lastSeenAt > CAMERA_STATION_RULES.imageRetentionMs) {
        this.stations.delete(id);
      } else if (
        station.latest &&
        now - Date.parse(station.latest.receivedAt) >
          CAMERA_STATION_RULES.imageRetentionMs
      ) {
        station.latest = null;
      }
    }
  }

  heartbeat(stationId: string): CameraStationState {
    const now = Date.now();
    this.cleanup(now);
    const existing = this.stations.get(stationId);
    if (!existing && this.stations.size >= CAMERA_STATION_RULES.maxStations) {
      const oldest = [...this.stations].sort(
        (a, b) => a[1].lastSeenAt - b[1].lastSeenAt,
      )[0];
      if (oldest) this.stations.delete(oldest[0]);
    }
    this.stations.set(stationId, {
      lastSeenAt: now,
      latest: existing?.latest ?? null,
    });
    return this.read(stationId);
  }

  publish(
    stationId: string,
    checkin: CheckinDetail,
    capturedPhoto: string,
  ): CameraStationState {
    this.heartbeat(stationId);
    this.stations.set(stationId, {
      lastSeenAt: Date.now(),
      latest: {
        checkin,
        capturedPhoto,
        receivedAt: new Date(Date.now()).toISOString(),
      },
    });
    return this.read(stationId);
  }

  read(stationId: string): CameraStationState {
    const now = Date.now();
    this.cleanup(now);
    const station = this.stations.get(stationId);
    return {
      stationId,
      online:
        !!station &&
        now - station.lastSeenAt <= CAMERA_STATION_RULES.onlineTimeoutMs,
      lastSeenAt: station ? new Date(station.lastSeenAt).toISOString() : null,
      latest: station?.latest ?? null,
    };
  }
}
