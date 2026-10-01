import { OVERALL_SHARE, TOPIC_SHARE, VERB_POINTS_PER_TIER } from './config';
import { bandsOf, computeLevels, type Levels } from './core/tiers';
import type { NodeState } from './core/unlock';
import { tenses, verbLevel, type TenseCard } from './core/verbs';
import type { WordNode } from './db/repo';

/** Verb level per conjugable verb. */
export function verbLevels(nodes: WordNode[], tenseCards: TenseCard[], now: Date) {
  const byNode = new Map<string, TenseCard[]>();
  for (const c of tenseCards) byNode.set(c.nodeId, [...(byNode.get(c.nodeId) ?? []), c]);
  return new Map(
    nodes.filter((n) => n.conjugations).map((n) => [n.id, verbLevel(byNode.get(n.id) ?? [], now)]),
  );
}

/**
 * Your levels: every topic's, and the overall one with what its next needs
 * (words and verbs). Single source of truth for what may be revealed.
 */
export function computeProgress(
  nodes: WordNode[],
  states: Map<string, NodeState>,
  tenseCards: TenseCard[],
  now: Date,
  /** Level names ("A1.2"): their bands limit how far a topic runs ahead. */
  names?: Record<string, string> | null,
): Levels {
  return computeLevels(
    nodes,
    states,
    verbLevels(nodes, tenseCards, now),
    {
      overallShare: OVERALL_SHARE,
      topicShare: TOPIC_SHARE,
      perTier: VERB_POINTS_PER_TIER,
      maxLevel: tenses().length,
    },
    bandsOf(names),
  );
}
