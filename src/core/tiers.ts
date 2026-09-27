import type { NodeState } from './unlock';

export type TierProgress = {
  /** Highest tier currently open. */
  tier: number;
  maxTier: number;
  /** Conquered words in tiers 1..tier. */
  conquered: number;
  /** Conquered words needed in tiers 1..tier to open the next tier (0 at max tier). */
  needed: number;
  /** Verbs at `verbLevel` or higher, and how many the next tier requires. */
  verbsHave: number;
  verbsNeed: number;
  verbLevel: number;
};

/** Verb requirement: `perTier` verbs of the open tiers at verb level >= tier. */
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
 * if verbs are given, enough of their verbs have reached `verbLevelFor(k)`
 * (presente for tier 2, passato prossimo for tier 3, ...). Derived from state,
 * never stored.
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
    const verbLevel = verbs ? verbLevelFor(tier, maxTier, verbs.maxLevel) : 0;
    // Verbs of the open tiers, plus the home category's (open at every level, like its words).
    const pool = verbs
      ? [...verbs.levels].filter(([id]) => (tiers.get(id) ?? 1) <= tier || !!campaign?.home.has(id))
      : [];
    const verbsNeed = verbs ? Math.min(verbs.perTier, pool.length) : 0;
    const verbsHave = pool.filter(([, lvl]) => lvl >= verbLevel).length;
    const base = { tier, maxTier, conquered, verbsHave, verbsNeed, verbLevel };
    if (tier >= maxTier) return { ...base, needed: 0, verbsNeed: 0 };
    if (conquered < needed || verbsHave < verbsNeed) return { ...base, needed };
    tier++;
  }
}

/**
 * Verb level needed to leave `tier`: one tense per tier, or spread evenly over
 * the tiers when there are more tiers than tenses (the last tense by the end).
 */
export function verbLevelFor(tier: number, maxTier: number, maxLevel: number): number {
  const spread = Math.max(1, (maxTier - 1) / maxLevel);
  return Math.min(maxLevel, Math.ceil(tier / spread - 1e-9));
}

/** Whether a node may be revealed at the given open tier. */
/** Words of the open tiers, plus `home`: the category you started in is open at every level. */
export const tierAllows =
  (tiers: Map<string, number>, tier: number, home?: Set<string>) => (id: string) =>
    (tiers.get(id) ?? 1) <= tier || !!home?.has(id);

export const tierMap = (nodes: { id: string; tier?: number | null }[]) =>
  new Map(nodes.map((n) => [n.id, n.tier ?? 1]));
