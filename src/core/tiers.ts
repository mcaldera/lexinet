import type { NodeState } from './unlock';

export type TierProgress = {
  /** Highest tier currently open. */
  tier: number;
  maxTier: number;
  /** Conquered words in tiers 1..tier. */
  conquered: number;
  /** Conquered words needed in tiers 1..tier to open the next tier (0 at max tier). */
  needed: number;
};

/**
 * Tier k+1 opens once `fraction` of the words in tiers 1..k are conquered.
 * Derived from node states, so it never needs storing.
 */
export function tierProgress(
  tiers: Map<string, number>,
  states: Map<string, NodeState>,
  fraction: number,
): TierProgress {
  const maxTier = Math.max(1, ...tiers.values());
  let tier = 1;
  for (;;) {
    let total = 0;
    let conquered = 0;
    for (const [id, t] of tiers) {
      if (t > tier) continue;
      total++;
      if (states.get(id) === 'conquered') conquered++;
    }
    const needed = Math.ceil(total * fraction);
    if (tier >= maxTier) return { tier, maxTier, conquered, needed: 0 };
    if (conquered < needed) return { tier, maxTier, conquered, needed };
    tier++;
  }
}

/** Whether a node may be revealed at the given open tier. */
export const tierAllows = (tiers: Map<string, number>, tier: number) => (id: string) =>
  (tiers.get(id) ?? 1) <= tier;

export const tierMap = (nodes: { id: string; tier?: number | null }[]) =>
  new Map(nodes.map((n) => [n.id, n.tier ?? 1]));
