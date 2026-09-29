import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';

export { Rating, State };
export type { Card, Grade };

export type Direction = 'it-en' | 'en-it';
export const DIRECTIONS: Direction[] = ['it-en', 'en-it'];

// No short-term learning steps (FSRS's 1 / 10 min re-asks): conquering already
// spaces the steps (core/claim.ts), so a right answer schedules the next review
// in days. With them, a word came back "due" minutes after being conquered.
const f = fsrs({ enable_fuzz: false, enable_short_term: false });

export function cardId(nodeId: string, direction: Direction): string {
  return `${nodeId}:${direction}`;
}

export function newCard(now: Date): Card {
  return createEmptyCard(now);
}

export function rate(card: Card, grade: Grade, now: Date): Card {
  return f.next(card, now, grade).card;
}

/**
 * Probability of recall at `now`; null for cards never reviewed. FSRS's curve,
 * but continuous: ts-fsrs counts whole days, so its recall moved in daily steps.
 */
export function retrievability(card: Card, now: Date): number | null {
  if (card.state === State.New || !card.last_review) return null;
  const days = Math.max(0, now.getTime() - card.last_review.getTime()) / DAY_MS;
  return Math.pow(1 + (FACTOR * days) / Math.max(card.stability, 1e-6), DECAY);
}

// ts-fsrs 4's forgetting curve: R = (1 + FACTOR * t / S) ^ DECAY (t, S in days).
const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY_MS = 86_400_000;
/** A card is due once its recall falls to this (FSRS's default target retention). */
export const DUE_RECALL = 0.9;

/** When a reviewed card's recall falls to `r` (ms); Infinity for a card never reviewed. */
export function recallTime(card: Card, r: number): number {
  if (card.state === State.New || !card.last_review) return Infinity;
  const days = (card.stability * (Math.pow(r, 1 / DECAY) - 1)) / FACTOR;
  return card.last_review.getTime() + days * DAY_MS;
}

/**
 * When a card is due: its scheduled date, or earlier once its recall is down
 * to 90%. ts-fsrs keeps "again < hard < good" intervals at least a day apart,
 * so a word learned after a miss (stability ~0.4 d) was scheduled 3 days out
 * while it faded within hours.
 */
export function dueAt(card: Card): number {
  return Math.min(card.due.getTime(), recallTime(card, DUE_RECALL));
}

export function isDue(card: Card, now: Date): boolean {
  return dueAt(card) <= now.getTime();
}

export function serializeCard(card: Card): string {
  return JSON.stringify(card);
}

export function deserializeCard(json: string): Card {
  const raw = JSON.parse(json);
  return {
    ...raw,
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}
