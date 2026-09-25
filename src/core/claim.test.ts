import { claimComplete, claimNext, claimStartedAt, claimSteps, recordClaim, unseen } from './claim';
import { State } from './scheduler';

const GAPS = { step: 60_000, recall: 10 * 60_000 };
const t0 = Date.UTC(2026, 0, 1);

test('recognise, produce after a break, then lock in after a longer one', () => {
  expect(claimNext(undefined, GAPS)).toEqual({
    step: 1,
    directions: ['it-en'],
    opensAt: -Infinity,
  });
  let c = recordClaim(undefined, 'en-it', t0, GAPS); // producing first doesn't count
  expect(claimSteps(c)).toBe(0);
  c = recordClaim(c, 'it-en', t0, GAPS);
  expect(claimSteps(c)).toBe(1);
  expect(claimNext(c, GAPS)).toEqual({ step: 2, directions: ['en-it'], opensAt: t0 + 60_000 });
  c = recordClaim(c, 'en-it', t0 + 5_000, GAPS); // straight after seeing it: copying, not recall
  expect(claimSteps(c)).toBe(1);
  c = recordClaim(c, 'it-en', t0 + 60_000, GAPS); // repeating a direction adds nothing
  expect(claimSteps(c)).toBe(1);
  c = recordClaim(c, 'en-it', t0 + 60_000, GAPS);
  expect(claimSteps(c)).toBe(2);
  expect(claimNext(c, GAPS)).toEqual({
    step: 3,
    directions: ['it-en', 'en-it'],
    opensAt: t0 + 60_000 + GAPS.recall,
  });
  c = recordClaim(c, 'it-en', t0 + 5 * 60_000, GAPS); // too soon: no recall yet
  expect(claimComplete(c)).toBe(false);
  c = recordClaim(c, 'en-it', t0 + 12 * 60_000, GAPS);
  expect(claimComplete(c)).toBe(true);
  expect(claimNext(c, GAPS)).toBeNull();
  expect(claimStartedAt(c)).toBe(t0);
});

test('a claim begun English -> Italian (older saves) finishes with the other direction', () => {
  const next = claimNext({ enIt: t0 }, GAPS);
  expect(next).toEqual({ step: 2, directions: ['it-en'], opensAt: t0 + 60_000 });
});

test('a word is unseen until one of its cards has been answered', () => {
  expect(unseen([{ card: { state: State.New } }, { card: { state: State.New } }])).toBe(true);
  expect(unseen([{ card: { state: State.Learning } }, { card: { state: State.New } }])).toBe(false);
});
