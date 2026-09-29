import { dueAt, rate, Rating, recallTime, State, type Card } from './scheduler';

/** Stability (days until recall drops to 90%) at which each strength level starts. */
export const STRENGTH_LEVELS = [1, 3, 7, 21, 60];
export const MAX_STRENGTH = STRENGTH_LEVELS.length;

/**
 * Strength 0-5 of a word from the FSRS stability of its reviewed cards. Stability
 * only grows with spaced, successful reviews, so cramming can't raise it.
 */
export function nodeStrength(cards: Card[]): { level: number; days: number } {
  const reviewed = cards.filter((c) => c.state !== State.New);
  if (!reviewed.length) return { level: 0, days: 0 };
  const days = reviewed.reduce((a, c) => a + c.stability, 0) / reviewed.length;
  return { level: STRENGTH_LEVELS.filter((t) => days >= t).length, days };
}

/** Practising a conquered word is allowed only once one of its cards is due. */
export function nextPractice(cards: Card[], now: Date): Date | null {
  const reviewed = cards.filter((c) => c.state !== State.New);
  if (reviewed.length < cards.length) return null; // an unreviewed direction is waiting
  const due = Math.min(...reviewed.map(dueAt));
  return due <= now.getTime() ? null : new Date(due);
}

/** Where a word's memory stands and where it goes next (NodeDetails' memory panel). */
export type MemoryOutlook = {
  level: number;
  /** Stability in days: after a review, recall stays above 90% about this long. */
  days: number;
  /** The review the current stretch started from (app ms). */
  since: number;
  /** When it is due (its weaker direction down to 90%) and when it breaks (80%). */
  due: number;
  breaks: number;
  /**
   * The next level: after this many more right answers, each given when due,
   * the first of them `at` (app ms), the last `reachedAt`. Unset at the top.
   */
  next?: { level: number; reviews: number; at: number; reachedAt: number };
};

/**
 * A reviewed word's outlook: the stretch from its last review to due and to
 * breaking, and what it takes to reach the next strength level (answering
 * right each time a card is due, from `now` on at the earliest).
 */
export function memoryOutlook(cards: Card[], now: Date, breakRecall = 0.8): MemoryOutlook | null {
  let reviewed = cards.filter((c) => c.state !== State.New);
  if (!reviewed.length) return null;
  const { level, days } = nodeStrength(reviewed);
  const first = reviewed.reduce((a, c) => (dueAt(c) < dueAt(a) ? c : a));
  const outlook: MemoryOutlook = {
    level,
    days,
    since: first.last_review?.getTime() ?? now.getTime(),
    due: dueAt(first),
    breaks: Math.min(...reviewed.map((c) => recallTime(c, breakRecall))),
  };
  if (level >= MAX_STRENGTH) return outlook;
  let at: number | undefined;
  for (let reviews = 1; reviews <= 12; reviews++) {
    const i = reviewed.reduce((b, c, k) => (dueAt(c) < dueAt(reviewed[b]) ? k : b), 0);
    const when = Math.max(now.getTime(), dueAt(reviewed[i]));
    at ??= when;
    reviewed = reviewed.map((c, k) => (k === i ? rate(c, Rating.Good, new Date(when)) : c));
    const reached = nodeStrength(reviewed).level;
    if (reached > level) {
      outlook.next = { level: reached, reviews, at, reachedAt: when };
      break;
    }
  }
  return outlook;
}
