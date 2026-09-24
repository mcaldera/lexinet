import { State, retrievability, type Card } from './scheduler';
import type { NodeState } from './unlock';

export type QueueCard = { id: string; nodeId: string; card: Card };

export type QueueInput<T extends QueueCard = QueueCard> = {
  cards: T[];
  states: Map<string, NodeState>;
  now: Date;
  /** Learning cards due within this window count as due (default 0: only when actually due). */
  learnAheadMs?: number;
  /** Card just shown; pushed back unless it is the only one left. */
  lastCardId?: string;
};

/**
 * The automatic queue: due review cards (weakest first), then learning cards,
 * then the unreviewed direction of nodes already started. Untouched frontier
 * nodes never appear; the user starts them by clicking the node.
 */
export function buildQueue<T extends QueueCard>(input: QueueInput<T>): T[] {
  const { cards, states, now, learnAheadMs = 0 } = input;
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
  const fresh = active.filter((c) => c.card.state === State.New && touched.has(c.nodeId));

  const queue = [...reviews, ...learning, ...fresh];
  if (input.lastCardId && queue.length > 1 && queue[0].id === input.lastCardId) {
    queue.push(queue.shift()!);
  }
  return queue;
}
