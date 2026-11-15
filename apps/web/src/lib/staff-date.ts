export function staffDate(offsetDays = 0, now = Date.now()): string {
  return new Date(now + 7 * 3600000 + offsetDays * 86400000)
    .toISOString()
    .slice(0, 10);
}
