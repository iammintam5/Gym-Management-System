export interface StaffRequestKey {
  fingerprint: string;
  key: string;
}

export function stableStaffRequestKey(
  previous: { current: StaffRequestKey | null },
  payload: Record<string, unknown>,
): string {
  const fingerprint = JSON.stringify(payload);
  if (!previous.current) {
    previous.current = { fingerprint, key: crypto.randomUUID() };
  }
  return previous.current.key;
}
