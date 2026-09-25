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
 * The automatic queue: due review cards (weakest first), then the unreviewed
 * direction of nodes already started, then learning cards. Untouched frontier
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

  // The second direction of a started word comes before relearning, so English ->
  // Italian cards don't get stuck behind a stream of Italian -> English retries.
  const queue = [...reviews, ...fresh, ...learning];
  if (input.lastCardId && queue.length > 1 && queue[0].id === input.lastCardId) {
    queue.push(queue.shift()!);
  }
  return queue;
}

/**
 * The queue near `anchor` (the word you are on): its own cards and those of
 * words linked to it, in queue order. The review never jumps across the map;
 * with no anchor yet (fresh start) the whole queue is fair game.
 */
export function nearby<T extends { nodeId: string }>(
  queue: T[],
  anchor: string | undefined,
  neighbours: Map<string, string[]>,
): T[] {
  if (!anchor) return queue;
  const near = new Set([anchor, ...(neighbours.get(anchor) ?? [])]);
  return queue.filter((c) => near.has(c.nodeId));
}

/**
 * The word to go to next: the candidate with the lowest link distance from
 * `from` plus its penalty (so an open claim step a few links away beats a new
 * word next door). Unreachable candidates come last; no `from` counts as 0.
 */
export function closest(
  from: string | undefined,
  neighbours: Map<string, string[]>,
  penalty: Map<string, number>,
): string | undefined {
  if (!penalty.size) return undefined;
  const dist = new Map<string, number>();
  if (from) {
    dist.set(from, 0);
    const todo = [from];
    while (todo.length) {
      const id = todo.shift()!;
      for (const n of neighbours.get(id) ?? []) {
        if (dist.has(n)) continue;
        dist.set(n, dist.get(id)! + 1);
        todo.push(n);
      }
    }
  }
  const cost = (id: string) => (from ? (dist.get(id) ?? 1e6) : 0) + penalty.get(id)!;
  return [...penalty.keys()].reduce((a, b) => (cost(b) < cost(a) ? b : a));
}
