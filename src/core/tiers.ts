import type { NodeState } from './unlock';

export type TierProgress = {
  /** Highest tier currently open. */
  tier: number;
  maxTier: number;
  /** Conquered words in tiers 1..tier. */
  conquered: number;
  /** Conquered words needed in tiers 1..tier to open the next tier (0 at max tier). */
  needed: number;
  /**
   * Verb points: every tense learned (and not faded) of any verb is one. One
   * verb with five tenses counts as much as five verbs with one.
   */
  verbPoints: number;
  /** Verb points the next tier requires (0 at the last tier). */
  pointsNeed: number;
};

/** Verb requirement: `perTier` verb points per tier, so leaving tier k takes perTier × k. */
export type VerbGate = { levels: Map<string, number>; perTier: number; maxLevel: number };

/**
 * A campaign: the player works from a home category and need not cover the rest.
 * Tier k+1 then needs `fraction` of the home words in tiers 1..k (at least
 * `minPerTier` × k words); conquered words of tiers 1..k count wherever they
 * are, and home words at any tier. The home is fixed, so exploring never lowers
 * the requirement's base or the tier.
 */
export type Campaign = { home: Set<string>; minPerTier: number };

/**
 * Tier k+1 opens once `fraction` of the words in tiers 1..k are conquered and,
 * if verbs are given, `perTier` × k verb points are earned (capped by what the
 * verbs in reach could give). Derived from state, never stored.
 */
export function tierProgress(
  tiers: Map<string, number>,
  states: Map<string, NodeState>,
  fraction: number,
  verbs?: VerbGate,
  campaign?: Campaign,
): TierProgress {
  const maxTier = Math.max(1, ...tiers.values());
  let tier = 1;
  for (;;) {
    let total = 0;
    let conquered = 0;
    let homeTotal = 0;
    for (const [id, t] of tiers) {
      const home = !!campaign?.home.has(id);
      if (home && t <= tier) homeTotal++;
      if (t > tier && !home) continue;
      total++;
      if (states.get(id) === 'conquered') conquered++;
    }
    const needed = campaign
      ? Math.min(total, Math.max(campaign.minPerTier * tier, Math.ceil(homeTotal * fraction)))
      : Math.ceil(total * fraction);
    // Every tense learned counts, whatever the verb's level (a verb planted from a later
    // level too). The cap looks at the verbs in reach: the open tiers, the home category
    // (open at every level, like its words) and any verb already started.
    const pool = verbs
      ? [...verbs.levels].filter(
          ([id, lvl]) => lvl > 0 || (tiers.get(id) ?? 1) <= tier || !!campaign?.home.has(id),
        )
      : [];
    const pointsNeed = verbs ? Math.min(verbs.perTier * tier, pool.length * verbs.maxLevel) : 0;
    const verbPoints = pool.reduce((sum, [, lvl]) => sum + lvl, 0);
    const base = { tier, maxTier, conquered, verbPoints, pointsNeed };
    if (tier >= maxTier) return { ...base, needed: 0, pointsNeed: 0 };
    if (conquered < needed || verbPoints < pointsNeed) return { ...base, needed };
    tier++;
  }
}

/** Whether a node may be revealed at the given open tier. */
/** Words of the open tiers, plus `home`: the category you started in is open at every level. */
export const tierAllows =
  (tiers: Map<string, number>, tier: number, home?: Set<string>) => (id: string) =>
    (tiers.get(id) ?? 1) <= tier || !!home?.has(id);

export const tierMap = (nodes: { id: string; tier?: number | null }[]) =>
  new Map(nodes.map((n) => [n.id, n.tier ?? 1]));
