import { meaningChoices } from './choices';

const pool = [
  { id: 'cane', en: 'dog', pos: 'noun', region: 1 },
  { id: 'gatto', en: 'cat', pos: 'noun', region: 1 },
  { id: 'cagnolino', en: 'small dog', pos: 'noun', region: 1 },
  { id: 'topo', en: 'mouse', pos: 'noun', region: 1 },
  { id: 'mucca', en: 'cow', pos: 'noun', region: 1 },
  { id: 'gatta', en: 'Cat', pos: 'noun', region: 1 },
  { id: 'pane', en: 'bread', pos: 'noun', region: 2 },
  { id: 'correre', en: 'to run', pos: 'verb', region: 1 },
];
const cane = pool[0];

test('the answer is among the choices, with decoys of the same kind', () => {
  const c = meaningChoices(cane, pool, 4, () => 0.3);
  expect(c).toHaveLength(4);
  expect(c).toContain('dog');
  expect(c).not.toContain('small dog'); // overlaps the answer
  expect(c).not.toContain('to run'); // another part of speech, not needed here
  expect(c).not.toContain('bread'); // another category, not needed here
});

test('no two choices mean the same', () => {
  for (const r of [0, 0.2, 0.5, 0.9]) {
    const c = meaningChoices(cane, pool, 5, () => r).map((e) => e.toLowerCase());
    expect(new Set(c).size).toBe(c.length);
  }
});

test('a small pool falls back to other categories and kinds', () => {
  const c = meaningChoices(cane, [cane, pool[6], pool[7]], 3, () => 0.5);
  expect([...c].sort()).toEqual(['bread', 'dog', 'to run']);
});
