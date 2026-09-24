import { tierAllows, tierProgress } from './tiers';
import type { NodeState } from './unlock';

const tiers = new Map([
  ['a', 1],
  ['b', 1],
  ['c', 1],
  ['d', 1],
  ['e', 2],
  ['f', 2],
  ['g', 3],
]);
const states = (conquered: string[]) =>
  new Map<string, NodeState>(
    [...tiers.keys()].map((id) => [id, conquered.includes(id) ? 'conquered' : 'locked']),
  );

test('tier 2 opens at 75% of tier 1', () => {
  expect(tierProgress(tiers, states(['a', 'b']), 0.75)).toEqual({
    tier: 1,
    maxTier: 3,
    conquered: 2,
    needed: 3,
  });
  expect(tierProgress(tiers, states(['a', 'b', 'c']), 0.75).tier).toBe(2);
});

test('progress counts all open tiers and stops at the top', () => {
  const p = tierProgress(tiers, states(['a', 'b', 'c', 'e']), 0.75);
  expect(p).toEqual({ tier: 2, maxTier: 3, conquered: 4, needed: 5 });
  const top = tierProgress(tiers, states(['a', 'b', 'c', 'd', 'e', 'f']), 0.75);
  expect(top).toEqual({ tier: 3, maxTier: 3, conquered: 6, needed: 0 });
});

test('tierAllows gates by tier; unknown ids count as tier 1', () => {
  const allow = tierAllows(tiers, 2);
  expect(['a', 'e', 'g', 'zzz'].map(allow)).toEqual([true, true, false, true]);
});
