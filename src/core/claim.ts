import { State, type Card, type Direction } from './scheduler';

/**
 * Progress of a freshly won ("claimed") word towards being conquered, in three
 * fixed steps (times in ms):
 * 1. recognise: Italian -> English, right away;
 * 2. produce: English -> Italian, once `step` has passed (so it is recalled, not copied);
 * 3. lock in: either direction, once `recall` has passed since step 2.
 */
export type Claim = { itEn?: number; enIt?: number; recall?: number };
export const CLAIM_STEPS = 3;
export type ClaimGaps = { step: number; recall: number };

export const CLAIM_STEP_NAMES = ['Recognise', 'Produce', 'Lock in'] as const;

export const claimSteps = (c?: Claim) =>
  (c?.itEn ? 1 : 0) + (c?.enIt ? 1 : 0) + (c?.recall ? 1 : 0);

export const claimComplete = (c?: Claim) => claimSteps(c) >= CLAIM_STEPS;

/** The step to do next: which directions count and when it opens (ms). */
export type ClaimStep = { step: 1 | 2 | 3; directions: Direction[]; opensAt: number };

export function claimNext(c: Claim | undefined, gaps: ClaimGaps): ClaimStep | null {
  if (!c?.itEn && !c?.enIt) return { step: 1, directions: ['it-en'], opensAt: -Infinity };
  if (!c.itEn || !c.enIt) {
    // Older claims may have started English -> Italian: finish the other one.
    const done = (c.itEn ?? c.enIt)!;
    return { step: 2, directions: [c.itEn ? 'en-it' : 'it-en'], opensAt: done + gaps.step };
  }
  if (!c.recall) {
    return {
      step: 3,
      directions: ['it-en', 'en-it'],
      opensAt: Math.max(c.itEn, c.enIt) + gaps.recall,
    };
  }
  return null;
}

/** Whether a correct answer in `direction` at `at` completes the next step. */
export const claimReady = (
  c: Claim | undefined,
  direction: Direction,
  at: number,
  gaps: ClaimGaps,
) => {
  const next = claimNext(c, gaps);
  return !!next && next.directions.includes(direction) && at >= next.opensAt;
};

/** Record a correct answer in `direction` at time `at`; answers out of turn add nothing. */
export function recordClaim(
  c: Claim | undefined,
  direction: Direction,
  at: number,
  gaps: ClaimGaps,
): Claim {
  const next = claimNext(c, gaps);
  if (!next || !claimReady(c, direction, at, gaps)) return { ...c };
  if (next.step === 3) return { ...c, recall: at };
  return { ...c, [direction === 'it-en' ? 'itEn' : 'enIt']: at };
}

/** When the claim started (first correct answer), for expiry. */
export const claimStartedAt = (c?: Claim) =>
  Math.min(c?.itEn ?? Infinity, c?.enIt ?? Infinity, c?.recall ?? Infinity);

/** A word never answered in either direction: not knowing it is learning, not a miss. */
export const unseen = (cards: { card: Pick<Card, 'state'> }[]) =>
  cards.every((c) => c.card.state === State.New);
