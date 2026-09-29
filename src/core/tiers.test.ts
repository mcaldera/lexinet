import { bandsOf, computeLevels, levelAllows, type LevelWord } from './tiers';
import type { NodeState } from './unlock';

// Two topics: 1 (a..f) and 2 (p..s), levels 1-4.
const words: LevelWord[] = [
  { id: 'a', tier: 1, region: 1 },
  { id: 'b', tier: 1, region: 1 },
  { id: 'c', tier: 2, region: 1 },
  { id: 'd', tier: 2, region: 1 },
  { id: 'e', tier: 3, region: 1 },
  { id: 'f', tier: 4, region: 1 },
  { id: 'p', tier: 2, region: 2 },
  { id: 'q', tier: 2, region: 2 },
  { id: 'r', tier: 3, region: 2 },
  { id: 's', tier: 4, region: 2 },
];
const states = (conquered: string[]) =>
  new Map<string, NodeState>(
    words.map((w) => [w.id, conquered.includes(w.id) ? 'conquered' : 'locked']),
  );
const rules = { overallShare: 0.5, topicShare: 0.5, perTier: 1, maxLevel: 6 };
const none = new Map<string, number>();

test('a topic climbs on its own words: half of those up to its level', () => {
  const l = computeLevels(words, states(['a']), none, rules);
  // Topic 1: a of a, b (level 1) is half: it climbs to 2, which needs 2 of a-d.
  expect(l.topics.get(1)).toMatchObject({ tier: 2, conquered: 1, needed: 2, held: 1, words: 6 });
  // Topic 2 has no level-1 words: it starts at level 2 already.
  expect(l.topics.get(2)).toMatchObject({ tier: 2, conquered: 0, needed: 1 });
});

test('the overall level counts the words you hold anywhere', () => {
  // Level 2 needs half of the 2 words of level 1: one held word, anywhere.
  expect(computeLevels(words, states([]), none, rules).overall).toMatchObject({
    tier: 1,
    held: 0,
    needed: 1,
  });
  expect(computeLevels(words, states(['p']), none, rules).overall).toMatchObject({
    tier: 2,
    held: 1,
    needed: 3, // half of the 6 words up to level 2
  });
});

test('a topic runs at most one band past the overall level', () => {
  // Hold the overall level back: it needs every word up to its level.
  const strict = { ...rules, overallShare: 1 };
  // Every level its own band: overall 2 lets topics reach level 3, no further.
  const l = computeLevels(words, states(['a', 'b']), none, strict);
  expect(l.overall.tier).toBe(2);
  expect(l.cap).toBe(3);
  expect(l.topics.get(1)).toMatchObject({ tier: 3, conquered: 2, needed: 3, capped: false });
  const held = computeLevels(words, states(['a', 'b', 'c', 'd', 'e']), none, strict);
  expect(held.overall.tier).toBe(2);
  expect(held.topics.get(1)).toMatchObject({ tier: 3, capped: true });
});

test('bands: a topic may climb through the band after the overall level', () => {
  const bandOf = bandsOf({ '1': 'A1.1', '2': 'A1.2', '3': 'A2.1', '4': 'B1' });
  expect([1, 2, 3, 4].map(bandOf)).toEqual([0, 0, 1, 2]);
  const l = computeLevels(
    words,
    states(['a', 'b', 'c', 'd', 'e']),
    none,
    { ...rules, overallShare: 1 },
    bandOf,
  );
  // Overall level 2 (band A1): topics may reach A2 (level 3), not B1.
  expect(l.overall.tier).toBe(2);
  expect(l.cap).toBe(3);
  expect(l.topics.get(1)).toMatchObject({ tier: 3, capped: true });
});

test('verb points gate the overall level: any mix of verbs and tenses', () => {
  const verbs = new Map([
    ['a', 0],
    ['b', 0],
  ]);
  const stuck = computeLevels(words, states(['a', 'b']), verbs, rules);
  expect(stuck.overall).toMatchObject({ tier: 1, verbPoints: 0, pointsNeed: 1 });
  const one = computeLevels(words, states(['a', 'b']), new Map([...verbs, ['a', 1]]), rules);
  expect(one.overall.tier).toBeGreaterThan(1);
});

test("what may be revealed: levels open in each word's topic", () => {
  const allows = levelAllows(words, computeLevels(words, states(['a']), none, rules));
  // Topic 1 is at 2, topic 2 at 2 (see above).
  expect(['a', 'c', 'e', 'p', 'r', 'zzz'].map(allows)).toEqual([
    true,
    true,
    false,
    true,
    false,
    true,
  ]);
});
