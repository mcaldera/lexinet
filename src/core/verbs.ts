import { checkAnswer, type Verdict } from './answer';
import { lang } from './language';
import { isDue, Rating, retrievability, type Card, type Grade } from './scheduler';

/** Tenses in the order courses teach them (per language); reaching each one is a verb level. */
export const tenses = () => lang().tenses;
export type Tense = string;
/** The persons of a conjugation table, in the order of its forms. */
export const persons = () => lang().persons;
/** A new tense can be learned this long after the previous one (no cramming). */
export const NEXT_TENSE_WAIT_MS = 20 * 3_600_000;

export type TenseCard = { id: string; nodeId: string; tense: Tense; card: Card };
export const tenseCardId = (nodeId: string, tense: Tense) => `${nodeId}:tense:${tense}`;

/** A learned tense counts towards the verb's level until its recall falls to this. */
export const TENSE_FADED = 0.5;

/** Level 0-n: consecutive tenses (from the present) learned and not faded away. */
export function verbLevel(cards: TenseCard[], now: Date): number {
  let level = 0;
  for (const tense of tenses()) {
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
  const ladder = tenses();
  const due = ladder.find((t) => {
    const c = cards.find((x) => x.tense === t);
    return c && isDue(c.card, now);
  });
  if (due) return { kind: 'defend', tense: due };
  const level = verbLevel(cards, now);
  if (level >= ladder.length) return { kind: 'done' };
  const tense = ladder[level];
  const prev = level > 0 ? cards.find((x) => x.tense === ladder[level - 1]) : undefined;
  const ready = prev?.card.last_review
    ? new Date(prev.card.last_review.getTime() + NEXT_TENSE_WAIT_MS)
    : now;
  return ready.getTime() <= now.getTime()
    ? { kind: 'learn', tense }
    : { kind: 'wait', tense, until: ready };
}

/** Check every person; all right (typos/accents tolerated) passes. */
export function checkConjugation(
  inputs: string[],
  expected: string[],
): { rows: Verdict[]; grade: Grade } {
  // A form may list alternatives ("würde gehen / ginge"): the best one counts.
  const rank = { correct: 0, almost: 1, wrong: 2 } as const;
  const rows = expected.map(
    (e, i) =>
      e
        .split(' / ')
        .map((option) => checkAnswer(inputs[i] ?? '', option, 'it').verdict)
        .sort((x, y) => rank[x] - rank[y])[0],
  );
  const grade = rows.includes('wrong')
    ? Rating.Again
    : rows.includes('almost')
      ? Rating.Hard
      : Rating.Good;
  return { rows, grade };
}
