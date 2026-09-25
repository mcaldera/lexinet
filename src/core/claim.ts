import type { Direction } from './scheduler';

/**
 * Progress of a freshly won ("claimed") word towards being conquered: both
 * directions right once, then a recall after a short break. Times in ms.
 */
export type Claim = { itEn?: number; enIt?: number; recall?: number };
export const CLAIM_STEPS = 3;

export const claimSteps = (c?: Claim) =>
  (c?.itEn ? 1 : 0) + (c?.enIt ? 1 : 0) + (c?.recall ? 1 : 0);

export const claimComplete = (c?: Claim) => claimSteps(c) >= CLAIM_STEPS;

/** When the recall step opens (both directions done + gap), if known. */
export function recallOpensAt(c: Claim | undefined, gapMs: number): number | undefined {
  if (!c?.itEn || !c?.enIt) return undefined;
  return Math.max(c.itEn, c.enIt) + gapMs;
}

/** Record a correct answer in `direction` at time `at`. */
export function recordClaim(
  c: Claim | undefined,
  direction: Direction,
  at: number,
  gapMs: number,
): Claim {
  const next: Claim = { ...c };
  const key = direction === 'it-en' ? 'itEn' : 'enIt';
  if (!next[key]) {
    next[key] = at;
    return next;
  }
  const opens = recallOpensAt(next, gapMs);
  if (!next.recall && opens !== undefined && at >= opens) next.recall = at;
  return next;
}

/** When the claim started (first correct answer), for expiry. */
export const claimStartedAt = (c?: Claim) =>
  Math.min(c?.itEn ?? Infinity, c?.enIt ?? Infinity, c?.recall ?? Infinity);
