import { retrievability, type Card } from './scheduler';

export type HealthBand = 'solid' | 'faded' | 'dashed' | 'cracked';

/** Mean retrievability of a node's reviewed cards; null if none reviewed yet. */
export function nodeHealth(cards: Card[], now: Date): number | null {
  const rs = cards.map((c) => retrievability(c, now)).filter((r): r is number => r !== null);
  if (rs.length === 0) return null;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

export function healthBand(health: number): HealthBand {
  if (health > 0.9) return 'solid';
  if (health > 0.7) return 'faded';
  if (health > 0.5) return 'dashed';
  return 'cracked';
}

export function edgeOpacity(a: number | null, b: number | null): number {
  return Math.min(a ?? 1, b ?? 1);
}
