export function memberCodeRange(
  value: string,
): { gte: string; lte: string } | undefined {
  const match = /^(?:MEM-)?([a-f0-9]{8})$/i.exec(value.trim());
  if (!match) return undefined;
  const prefix = match[1]!.toLowerCase();
  return {
    gte: `${prefix}-0000-0000-0000-000000000000`,
    lte: `${prefix}-ffff-ffff-ffff-ffffffffffff`,
  };
}
