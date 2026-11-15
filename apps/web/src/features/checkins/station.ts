import { CAMERA_STATION_RULES } from '@gym/contracts';

export function resolveStationId(value: string | null): string {
  return value && /^[a-zA-Z0-9_-]{1,50}$/.test(value)
    ? value
    : CAMERA_STATION_RULES.defaultStationId;
}

export function cameraStationPath(stationId: string): string {
  return `/camera?station=${encodeURIComponent(resolveStationId(stationId))}`;
}
