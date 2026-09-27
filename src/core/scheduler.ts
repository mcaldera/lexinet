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

/** Probability of recall at `now`; null for cards never reviewed. */
export function retrievability(card: Card, now: Date): number | null {
  if (card.state === State.New) return null;
  return f.get_retrievability(card, now, false);
}

export function isDue(card: Card, now: Date): boolean {
  return card.due.getTime() <= now.getTime();
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
