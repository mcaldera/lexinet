/** Days played: the streak and a calendar, from review times (app time). */

/** Local calendar day, e.g. "2026-09-25". */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Consecutive days with at least one answer, ending today, or yesterday if
 * today hasn't been played yet (the streak is still alive until midnight).
 * `best` is the longest run ever.
 */
export function streak(activity: Map<string, number>, today: Date) {
  const played = (d: Date) => (activity.get(dayKey(d)) ?? 0) > 0;
  let current = 0;
  let d = played(today) ? today : addDays(today, -1);
  while (played(d)) {
    current++;
    d = addDays(d, -1);
  }
  const days = [...activity]
    .filter(([, n]) => n > 0)
    .map(([k]) => k)
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | undefined;
  for (const k of days) {
    const [y, m, dd] = k.split('-').map(Number);
    run = prev === dayKey(addDays(new Date(y, m - 1, dd), -1)) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current, best: Math.max(best, current), playedToday: played(today) };
}

/** The last `weeks` weeks, Monday first, as columns of 7 days (later days: null). */
export function calendar(activity: Map<string, number>, today: Date, weeks: number) {
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const start = addDays(monday, -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, w * 7 + i);
      return d > today ? null : { key: dayKey(d), count: activity.get(dayKey(d)) ?? 0 };
    }),
  );
}
