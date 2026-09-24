export const DAY_MS = 86_400_000;

/** App time = real time shifted by the debug day offset. All scheduling uses this. */
export function appNow(offsetDays: number, realNow: number = Date.now()): Date {
  return new Date(realNow + offsetDays * DAY_MS);
}

/** Local-midnight start of the day containing `now` (for "new nodes today" limits). */
export function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
