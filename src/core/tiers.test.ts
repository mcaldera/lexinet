import { tierAllows, tierProgress, verbLevelFor } from './tiers';
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
  expect(tierProgress(tiers, states(['a', 'b']), 0.75)).toMatchObject({
    tier: 1,
    maxTier: 3,
    conquered: 2,
    needed: 3,
  });
  expect(tierProgress(tiers, states(['a', 'b', 'c']), 0.75).tier).toBe(2);
});

test('progress counts all open tiers and stops at the top', () => {
  const p = tierProgress(tiers, states(['a', 'b', 'c', 'e']), 0.75);
  expect(p).toMatchObject({ tier: 2, maxTier: 3, conquered: 4, needed: 5 });
  const top = tierProgress(tiers, states(['a', 'b', 'c', 'd', 'e', 'f']), 0.75);
  expect(top).toMatchObject({ tier: 3, maxTier: 3, conquered: 6, needed: 0 });
});

test('tierAllows gates by tier; unknown ids count as tier 1', () => {
  const allow = tierAllows(tiers, 2);
  expect(['a', 'e', 'g', 'zzz'].map(allow)).toEqual([true, true, false, true]);
});

test('verbs gate tiers: tier 2 needs verbs at level 1, capped by verbs available', () => {
  const done = states(['a', 'b', 'c', 'd']);
  const gate = (levels: [string, number][]) => ({
    levels: new Map(levels),
    perTier: 2,
    maxLevel: 6,
  });
  // a and b are verbs of tier 1; only one has learned presente -> stuck at tier 1.
  const stuck = tierProgress(
    tiers,
    done,
    0.75,
    gate([
      ['a', 1],
      ['b', 0],
    ]),
  );
  expect(stuck).toMatchObject({ tier: 1, verbsHave: 1, verbsNeed: 2, verbLevel: 1 });
  expect(
    tierProgress(
      tiers,
      done,
      0.75,
      gate([
        ['a', 1],
        ['b', 1],
      ]),
    ).tier,
  ).toBe(2);
  // Only one verb exists in tier 1: requirement shrinks to 1.
  expect(tierProgress(tiers, done, 0.75, gate([['a', 1]])).tier).toBe(2);
});

test('verb levels follow tiers, spread out when there are more tiers than tenses', () => {
  expect([1, 2, 3, 4, 5].map((t) => verbLevelFor(t, 6, 6))).toEqual([1, 2, 3, 4, 5]);
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => verbLevelFor(t, 10, 6))).toEqual([
    1, 2, 2, 3, 4, 4, 5, 6, 6,
  ]);
});

test('the home category is open at every level', () => {
  const tiers = new Map([
    ['a', 1],
    ['b', 3],
    ['c', 3],
  ]);
  const allowed = tierAllows(tiers, 1, new Set(['b']));
  expect(['a', 'b', 'c'].map(allowed)).toEqual([true, true, false]);
});

test('a campaign measures levels by the home category, counting words from anywhere', () => {
  // Home: a, e, g. Tier 1 needs max(1 × 1, 60% of {a}) = 1 word.
  const campaign = { home: new Set(['a', 'e', 'g']), minPerTier: 1 };
  expect(tierProgress(tiers, states([]), 0.6, undefined, campaign)).toMatchObject({
    tier: 1,
    needed: 1,
  });
  // b is not home but tier 1: it counts. Tier 2 needs max(2, 60% of {a, e}) = 2.
  expect(tierProgress(tiers, states(['b']), 0.6, undefined, campaign)).toMatchObject({
    tier: 2,
    needed: 2,
  });
  // g is home (tier 3) and counts already at tier 2.
  expect(tierProgress(tiers, states(['b', 'g']), 0.6, undefined, campaign).tier).toBe(3);
});

test("the home category's verbs count for the verb requirement at any level", () => {
  const tiers = new Map([
    ['a', 1],
    ['v', 3],
  ]);
  const states = new Map<string, 'conquered'>([['a', 'conquered']]);
  const verbs = { levels: new Map([['v', 0]]), perTier: 1, maxLevel: 6 };
  // A tier-3 verb elsewhere asks for nothing yet: the level moves on.
  const away = tierProgress(tiers, states, 0.5, verbs, { home: new Set(['a']), minPerTier: 1 });
  expect(away.tier).toBeGreaterThan(1);
  // The same verb at home is in reach, so it is what the next level asks for.
  const home = tierProgress(tiers, states, 0.5, verbs, {
    home: new Set(['a', 'v']),
    minPerTier: 1,
  });
  expect(home.tier).toBe(1);
  expect([home.verbsHave, home.verbsNeed]).toEqual([0, 1]);
});
