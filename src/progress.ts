import { TIER_MIN_WORDS, TIER_UNLOCK_FRACTION, VERB_POINTS_PER_TIER } from './config';
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
    { levels, perTier: VERB_POINTS_PER_TIER, maxLevel: TENSES.length },
    { home, minPerTier: TIER_MIN_WORDS },
  );
}
