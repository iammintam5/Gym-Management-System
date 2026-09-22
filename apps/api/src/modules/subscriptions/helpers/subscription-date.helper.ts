export function normalizeDate(dateInput?: string | Date): Date {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date value');
  }
  return d;
}

export function calculateEndDate(startDate: Date, durationDays: number): Date {
  if (durationDays <= 0) {
    throw new Error('durationDays must be positive');
  }
  const end = new Date(startDate.getTime());
  end.setUTCDate(end.getUTCDate() + durationDays);
  return end;
}
