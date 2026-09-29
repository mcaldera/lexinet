import { FULL_NAME, NO_NAME } from './fade';
import { recallTime, retrievability, type Card } from './scheduler';

export type HealthBand = 'solid' | 'faded' | 'dashed' | 'cracked';

/**
 * A word's recall: its weaker reviewed direction (a direction you forgot is a
 * gap too); null if none is reviewed yet.
 */
export function nodeHealth(cards: Card[], now: Date): number | null {
  const rs = cards.map((c) => retrievability(c, now)).filter((r): r is number => r !== null);
  return rs.length ? Math.min(...rs) : null;
}

/** When a word's recall falls to `r` (its weaker direction first): ms, Infinity if never reviewed. */
export function forgetAt(cards: Card[], r: number): number {
  return Math.min(Infinity, ...cards.map((c) => recallTime(c, r)));
}

/** Solid until due (90%), then fading towards broken (80%). */
export function healthBand(health: number): HealthBand {
  if (health >= FULL_NAME) return 'solid';
  if (health > (FULL_NAME + NO_NAME) / 2) return 'faded';
  if (health > NO_NAME) return 'dashed';
  return 'cracked';
}

export function edgeOpacity(a: number | null, b: number | null): number {
  return Math.min(a ?? 1, b ?? 1);
}
