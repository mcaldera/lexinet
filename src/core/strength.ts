import { dueAt, State, type Card } from './scheduler';

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
