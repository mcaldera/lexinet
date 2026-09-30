export const DAY_MS = 86_400_000;

/** App time = real time shifted by the debug day offset. All scheduling uses this. */
export function appNow(offsetDays: number, realNow: number = Date.now()): Date {
  return new Date(realNow + offsetDays * DAY_MS);
}

/**
 * How many times faster than real time app time runs while fast-forwarding to
 * something `leftMs` (app time) away: `speed`, slower where that would land
 * sooner than `minRealMs` (real time) from now, never slower than real time.
 */
export function fastRate(leftMs: number, minRealMs: number, speed: number): number {
  if (leftMs <= 0) return 1;
  return Math.max(1, Math.min(speed, minRealMs > 0 ? leftMs / minRealMs : speed));
}

/** Local-midnight start of the day containing `now` (for "new nodes today" limits). */
export function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
