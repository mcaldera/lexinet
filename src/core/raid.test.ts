import { defend, raidReward, raidStarts, raidStatus, raidTargets } from './raid';

const rules = { durationMs: 180_000, targets: 3, gapMs: 1_200_000, chance: 0.2 };

test('a raid hits random words, chokepoints more often', () => {
  const hang = new Map([
    ['a', 0],
    ['b', 14],
    ['c', 0],
  ]);
  // Weights 1, 8, 1: a draw at 0.05 of the total lands on a, at 0.5 on b.
  expect(raidTargets(hang, 1, () => 0.05)).toEqual(['a']);
  expect(raidTargets(hang, 1, () => 0.5)).toEqual(['b']);
  expect(raidTargets(hang, 5).sort()).toEqual(['a', 'b', 'c']); // never twice
  expect(raidTargets(new Map(), 3)).toEqual([]);
  // Over many raids the chokepoint is hit most, but plain words are hit too.
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hits = new Map<string, number>();
  for (let i = 0; i < 2000; i++) {
    const [t] = raidTargets(hang, 1, rnd);
    hits.set(t, (hits.get(t) ?? 0) + 1);
  }
  expect(hits.get('b')!).toBeGreaterThan(hits.get('a')!);
  expect(hits.get('a')!).toBeGreaterThan(100);
});

test('raids need a border, a pause since the last one and some luck', () => {
  expect(raidStarts(undefined, false, ['a'], 0, rules, () => 0.1)).toBe(true);
  expect(raidStarts(undefined, false, ['a'], 0, rules, () => 0.5)).toBe(false);
  expect(raidStarts(undefined, true, ['a'], 0, rules, () => 0)).toBe(false);
  expect(raidStarts(undefined, false, [], 0, rules, () => 0)).toBe(false);
  expect(raidStarts(1000, false, ['a'], 1000 + rules.gapMs - 1, rules, () => 0)).toBe(false);
});

test('defend every target in time to win; the rest are hit when time runs out', () => {
  const raid = { targets: ['a', 'b'], defended: [], start: 0, until: 100 };
  expect(raidStatus(raid, 50).state).toBe('on');
  const one = defend(defend(raid, 'a'), 'x');
  expect(one.defended).toEqual(['a']);
  expect(raidStatus(one, 100)).toEqual({ state: 'lost', hit: ['b'] });
  expect(raidStatus(defend(one, 'b'), 100)).toEqual({ state: 'won', hit: [] });
});

test('a passed raid pays more the more time is left', () => {
  const raid = { targets: ['a'], defended: ['a'], start: 0, until: 180_000 };
  const rules = { coins: 3, bonus: 1, bonusEveryMs: 30_000 };
  expect(raidReward(raid, 50_000, rules)).toEqual({ coins: 7, speed: 4, tookMs: 50_000 });
  expect(raidReward(raid, 179_000, rules)).toEqual({ coins: 3, speed: 0, tookMs: 179_000 });
});
