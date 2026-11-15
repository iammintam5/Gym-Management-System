import type { PaginationMeta } from '../users';

export enum CheckinStatus {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export interface CheckinDetail {
  id: string;
  requestId?: string | null;
  stationId?: string | null;
  memberId: string;
  memberCode: string;
  memberFullName: string;
  memberIdPhotoUrl?: string | null;
  memberGender?: string | null;
  subscriptionId: string | null;
  planName: string | null;
  quotaId: string | null;
  status: CheckinStatus;
  rejectionReason: string | null;
  checkedInAt: string;
  recordedBy: string | null;
  recordedByName: string | null;
}

export interface PaginatedCheckinsResponse {
  data: CheckinDetail[];
  meta: PaginationMeta;
}

export interface TodayCheckinStats {
  total: number;
  accepted: number;
  rejected: number;
}

/** Latest comparison image is transient and is never used to replace the member's ID photo. */
export interface CreateCheckinRequest {
  memberId?: string;
  memberCode?: string;
  gateIdentifier?: string;
  idempotencyKey?: string;
  photoVersion?: string;
}

export interface CameraRosterMember {
  id: string;
  fullName: string;
  photoVersion: string;
}

export interface CameraMemberPhoto extends CameraRosterMember {
  idPhotoUrl: string;
}

export interface CameraCheckinRequest {
  idempotencyKey: string;
  photoVersion: string;
  memberId: string;
  stationId: string;
  capturedPhoto: string;
}

export interface CameraStationEvent {
  checkin: CheckinDetail;
  capturedPhoto: string;
  receivedAt: string;
}

export interface CameraStationState {
  latestUnchanged?: boolean;
  stationId: string;
  online: boolean;
  lastSeenAt: string | null;
  latest: CameraStationEvent | null;
}

export const CAMERA_STATION_RULES = {
  defaultStationId: 'front-desk',
  pollIntervalMs: 2000,
  heartbeatIntervalMs: 10000,
  onlineTimeoutMs: 30000,
  imageRetentionMs: 10 * 60 * 1000,
  maxImageLength: 350000,
  maxStations: 32,
} as const;
