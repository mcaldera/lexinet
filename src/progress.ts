import { REACH, TIER_MIN_WORDS, TIER_UNLOCK_FRACTION, VERBS_PER_TIER } from './config';
import type { Claim } from './core/claim';
import { reachMap, type ReachInput } from './core/reach';
import { tierMap, tierProgress, type TierProgress } from './core/tiers';
import type { NodeState } from './core/unlock';
import { TENSES, verbLevel, type TenseCard } from './core/verbs';
import type { WordNode } from './db/repo';

/** Verb level per conjugable verb. */
export function verbLevels(nodes: WordNode[], tenseCards: TenseCard[], now: Date) {
  const byNode = new Map<string, TenseCard[]>();
  for (const c of tenseCards) byNode.set(c.nodeId, [...(byNode.get(c.nodeId) ?? []), c]);
  return new Map(
    nodes.filter((n) => n.conjugations).map((n) => [n.id, verbLevel(byNode.get(n.id) ?? [], now)]),
  );
}

/** The open tier and what the next one needs (words and verbs). Single source of truth. */
export function computeProgress(
  nodes: WordNode[],
  states: Map<string, NodeState>,
  tenseCards: TenseCard[],
  now: Date,
  /** The start word's category (core/start `homeWords`): levels follow this campaign. */
  home: Set<string>,
): TierProgress {
  const levels = verbLevels(nodes, tenseCards, now);
  return tierProgress(
    tierMap(nodes),
    states,
    TIER_UNLOCK_FRACTION,
    { levels, perTier: VERBS_PER_TIER, maxLevel: TENSES.length },
    { home, minPerTier: TIER_MIN_WORDS },
  );
}

/** Everything reach (core/reach.ts) needs, from the current states and claims. */
export function reachInput(
  nodes: WordNode[],
  neighbours: Map<string, string[]>,
  states: Map<string, NodeState>,
  claims: Map<string, Claim | undefined>,
  seed: string,
  levels?: Map<string, number>,
): ReachInput {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    states,
    claims,
    neighbours,
    regionOf: (id) => byId.get(id)?.region ?? undefined,
    posOf: (id) => byId.get(id)?.pos,
    verbLevels: levels,
    seed,
    rules: REACH,
  };
}

/** Reach of every word (core/reach.ts). */
export const computeReach = (...args: Parameters<typeof reachInput>) =>
  reachMap(reachInput(...args));
