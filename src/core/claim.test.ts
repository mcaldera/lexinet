import { claimComplete, claimStartedAt, claimSteps, recallOpensAt, recordClaim } from './claim';

const GAP = 10 * 60_000;
const t0 = Date.UTC(2026, 0, 1);

test('both directions, then a recall after the gap, conquer the word', () => {
  let c = recordClaim(undefined, 'it-en', t0, GAP);
  expect(claimSteps(c)).toBe(1);
  c = recordClaim(c, 'it-en', t0 + 1000, GAP); // repeating a direction adds nothing
  expect(claimSteps(c)).toBe(1);
  c = recordClaim(c, 'en-it', t0 + 60_000, GAP);
  expect(claimSteps(c)).toBe(2);
  expect(recallOpensAt(c, GAP)).toBe(t0 + 60_000 + GAP);
  c = recordClaim(c, 'it-en', t0 + 5 * 60_000, GAP); // too soon: no recall yet
  expect(claimComplete(c)).toBe(false);
  c = recordClaim(c, 'en-it', t0 + 12 * 60_000, GAP);
  expect(claimComplete(c)).toBe(true);
  expect(claimStartedAt(c)).toBe(t0);
});
