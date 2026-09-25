import { ACHIEVEMENTS, newlyEarned, type Stats } from './achievements';

const base: Stats = {
  conquered: 0,
  revealed: 5,
  categories: [{ words: 8, conquered: 0 }],
  cohesionAt: () => 0,
  verbLevels: [],
  score: 0,
  planted: 0,
};

test('milestones are earned once, and only the new ones are reported', () => {
  const s = { ...base, conquered: 12, categories: [{ words: 12, conquered: 5 }], score: 120 };
  const ids = newlyEarned(s, {}).map((a) => a.id);
  expect(ids).toEqual(['words-1', 'words-10', 'cat-settler', 'score-100']);
  expect(newlyEarned(s, { 'words-1': 1, 'words-10': 1 }).map((a) => a.id)).toEqual([
    'cat-settler',
    'score-100',
  ]);
});

test('category and verb achievements', () => {
  const s = {
    ...base,
    categories: [{ words: 6, conquered: 6 }],
    cohesionAt: (n: number) => (n <= 5 ? 0.7 : 0),
    verbLevels: [1, 3, 0],
  };
  const ids = newlyEarned(s, {}).map((a) => a.id);
  expect(ids).toEqual(
    expect.arrayContaining(['cat-half', 'cat-full', 'tight-knit', 'verb-first', 'verb-three']),
  );
  expect(ids).not.toContain('fortress');
  expect(ids).not.toContain('verb-squad');
});

test('every achievement has a unique id and pays seeds', () => {
  expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  expect(ACHIEVEMENTS.every((a) => a.seeds > 0)).toBe(true);
});
