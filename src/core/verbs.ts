import { checkAnswer, type Verdict } from './answer';
import { isDue, Rating, retrievability, type Card, type Grade } from './scheduler';

/** Tenses in the order courses teach them; reaching each one is a verb level. */
export const TENSES = [
  'presente',
  'passato prossimo',
  'imperfetto',
  'futuro',
  'condizionale',
  'congiuntivo',
] as const;
export type Tense = (typeof TENSES)[number];
export const PRONOUNS = ['io', 'tu', 'lui/lei', 'noi', 'voi', 'loro'];
/** A new tense can be learned this long after the previous one (no cramming). */
export const NEXT_TENSE_WAIT_MS = 20 * 3_600_000;

export type TenseCard = { id: string; nodeId: string; tense: Tense; card: Card };
export const tenseCardId = (nodeId: string, tense: Tense) => `${nodeId}:tense:${tense}`;

/** A learned tense counts towards the verb's level until its recall falls to this. */
export const TENSE_FADED = 0.5;

/** Level 0-6: consecutive tenses (from presente) learned and not faded away. */
export function verbLevel(cards: TenseCard[], now: Date): number {
  let level = 0;
  for (const tense of TENSES) {
    const c = cards.find((t) => t.tense === tense);
    if (!c || (retrievability(c.card, now) ?? 1) <= TENSE_FADED) break;
    level++;
  }
  return level;
}

export type Drill =
  | { kind: 'defend' | 'learn'; tense: Tense }
  | { kind: 'wait'; tense: Tense; until: Date }
  | { kind: 'done' };

/** What clicking a conquered verb offers: a due tense first, else the next tense. */
export function nextDrill(cards: TenseCard[], now: Date): Drill {
  const due = TENSES.find((t) => {
    const c = cards.find((x) => x.tense === t);
    return c && isDue(c.card, now);
  });
  if (due) return { kind: 'defend', tense: due };
  const level = verbLevel(cards, now);
  if (level >= TENSES.length) return { kind: 'done' };
  const tense = TENSES[level];
  const prev = level > 0 ? cards.find((x) => x.tense === TENSES[level - 1]) : undefined;
  const ready = prev?.card.last_review
    ? new Date(prev.card.last_review.getTime() + NEXT_TENSE_WAIT_MS)
    : now;
  return ready.getTime() <= now.getTime()
    ? { kind: 'learn', tense }
    : { kind: 'wait', tense, until: ready };
}

/** Check the six persons; all right (typos/accents tolerated) passes. */
export function checkConjugation(
  inputs: string[],
  expected: string[],
): { rows: Verdict[]; grade: Grade } {
  const rows = expected.map((e, i) => checkAnswer(inputs[i] ?? '', e, 'it').verdict);
  const grade = rows.includes('wrong')
    ? Rating.Again
    : rows.includes('almost')
      ? Rating.Hard
      : Rating.Good;
  return { rows, grade };
}
