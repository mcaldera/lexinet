/**
 * Raids: now and then a raid strikes your chokepoints. The raided words must
 * each be answered right before `until` (app time); any left undefended break,
 * cutting off whatever hangs on them. Defending all of them pays coins.
 */
export type Raid = { targets: string[]; defended: string[]; start: number; until: number };
export type RaidRules = { durationMs: number; targets: number; gapMs: number; chance: number };

/**
 * What a raid hits: up to `max` supplied words drawn at random, a word weighing
 * 1 + half the words hanging on it (core/supply.ts `hanging`). Mostly plain
 * words, now and then a chokepoint: the stakes aren't always high.
 */
export function raidTargets(
  hang: Map<string, number>,
  max: number,
  random: () => number = Math.random,
): string[] {
  const pool = [...hang].map(([id, n]) => ({ id, w: 1 + n / 2 }));
  const out: string[] = [];
  while (out.length < max && pool.length) {
    let r = random() * pool.reduce((a, p) => a + p.w, 0);
    const i = Math.max(
      0,
      pool.findIndex((p) => (r -= p.w) < 0),
    );
    out.push(pool.splice(i, 1)[0].id);
  }
  return out;
}

/** Whether a raid starts now: none on, long enough since the last, a border to hit, luck. */
export function raidStarts(
  last: number | undefined,
  active: boolean,
  targets: string[],
  t: number,
  rules: RaidRules,
  random: () => number = Math.random,
): boolean {
  if (active || !targets.length) return false;
  if (last !== undefined && t - last < rules.gapMs) return false;
  return random() < rules.chance;
}

export const defend = (raid: Raid, id: string): Raid =>
  raid.targets.includes(id) && !raid.defended.includes(id)
    ? { ...raid, defended: [...raid.defended, id] }
    : raid;

/**
 * What a passed raid pays at `t`: `coins`, plus `bonus` for every full
 * `bonusEveryMs` left on the clock (answering fast is the fun of it).
 */
export function raidReward(
  raid: Raid,
  t: number,
  rules: { coins: number; bonus: number; bonusEveryMs: number },
) {
  const speed = Math.max(0, Math.floor((raid.until - t) / rules.bonusEveryMs)) * rules.bonus;
  return { coins: rules.coins + speed, speed, tookMs: t - raid.start };
}

/** Still on, won (all defended) or over (time's up: `hit` lists the undefended). */
export function raidStatus(raid: Raid, t: number) {
  const open = raid.targets.filter((id) => !raid.defended.includes(id));
  if (!open.length) return { state: 'won' as const, hit: [] };
  if (t >= raid.until) return { state: 'lost' as const, hit: open };
  return { state: 'on' as const, hit: [] };
}
