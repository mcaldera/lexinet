import type { NodeState } from './unlock';

/**
 * Raids: now and then hostile words strike a weak border. The raided words
 * must each be answered right before `until` (app time); any left undefended
 * lose control. Defending all of them pays coins.
 */
export type Raid = { targets: string[]; defended: string[]; start: number; until: number };
export type RaidRules = { durationMs: number; targets: number; gapMs: number; chance: number };

/**
 * Conquered words next to a hostile word, weakest (lowest health) first: the
 * border a raid would hit. Empty when nothing borders a hostile word.
 */
export function raidTargets(
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
  hostile: Set<string>,
  health: Map<string, number | null>,
  max: number,
): string[] {
  return [...states]
    .filter(
      ([id, st]) => st === 'conquered' && (neighbours.get(id) ?? []).some((n) => hostile.has(n)),
    )
    .map(([id]) => id)
    .sort((a, b) => (health.get(a) ?? 1) - (health.get(b) ?? 1))
    .slice(0, max);
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

/** Still on, won (all defended) or over (time's up: `hit` lists the undefended). */
export function raidStatus(raid: Raid, t: number) {
  const open = raid.targets.filter((id) => !raid.defended.includes(id));
  if (!open.length) return { state: 'won' as const, hit: [] };
  if (t >= raid.until) return { state: 'lost' as const, hit: open };
  return { state: 'on' as const, hit: [] };
}
