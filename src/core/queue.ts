import { State, retrievability, type Card } from './scheduler';
import type { NodeState } from './unlock';

export type QueueCard = { id: string; nodeId: string; card: Card };

export type QueueInput = {
  cards: QueueCard[];
  states: Map<string, NodeState>;
  now: Date;
  /** Distinct nodes first reviewed today. */
  newNodesToday: number;
  newPerDay: number;
  /** Learning cards due within this window count as due, so a session can finish them. */
  learnAheadMs?: number;
  /** Card just shown; pushed back unless it is the only one left. */
  lastCardId?: string;
};

/**
 * Review order: due review cards (weakest first), then learning cards, then new
 * cards. New cards of untouched frontier nodes are capped by the daily limit.
 */
export function buildQueue(input: QueueInput): QueueCard[] {
  const { cards, states, now, newNodesToday, newPerDay, learnAheadMs = 20 * 60_000 } = input;
  const t = now.getTime();
  const active = cards.filter((c) => states.get(c.nodeId) !== 'locked');

  const reviews = active
    .filter((c) => c.card.state === State.Review && c.card.due.getTime() <= t)
    .sort((a, b) => (retrievability(a.card, now) ?? 0) - (retrievability(b.card, now) ?? 0));

  const learning = active
    .filter(
      (c) =>
        (c.card.state === State.Learning || c.card.state === State.Relearning) &&
        c.card.due.getTime() <= t + learnAheadMs,
    )
    .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());

  const touched = new Set(active.filter((c) => c.card.state !== State.New).map((c) => c.nodeId));
  let budget = Math.max(0, newPerDay - newNodesToday);
  const admitted = new Set<string>();
  const fresh: QueueCard[] = [];
  for (const c of active.filter((c) => c.card.state === State.New)) {
    if (!touched.has(c.nodeId) && !admitted.has(c.nodeId)) {
      if (budget === 0) continue;
      budget--;
      admitted.add(c.nodeId);
    }
    fresh.push(c);
  }

  const queue = [...reviews, ...learning, ...fresh];
  if (input.lastCardId && queue.length > 1 && queue[0].id === input.lastCardId) {
    queue.push(queue.shift()!);
  }
  return queue;
}
