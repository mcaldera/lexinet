import { Rating } from './scheduler';
import { applyChanges, initialStates, neighbourMap, unlockChanges } from './unlock';

const edges = [
  { source: 'a', target: 'b' },
  { source: 'a', target: 'c' },
  { source: 'c', target: 'd' },
];
const nb = neighbourMap(edges);

test('only the seed starts as frontier', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  expect([...s.values()]).toEqual(['frontier', 'locked', 'locked', 'locked']);
});

test('Good on a frontier node conquers it and reveals locked neighbours', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  const ch = unlockChanges('a', Rating.Good, s, nb);
  expect(ch).toEqual([
    { id: 'a', state: 'conquered' },
    { id: 'b', state: 'frontier' },
    { id: 'c', state: 'frontier' },
  ]);
  const s2 = applyChanges(s, ch);
  expect(s2.get('d')).toBe('locked');
  // Conquering c reveals d but does not touch a (already conquered).
  expect(unlockChanges('c', Rating.Easy, s2, nb)).toEqual([
    { id: 'c', state: 'conquered' },
    { id: 'd', state: 'frontier' },
  ]);
});

test('Again/Hard and non-frontier nodes cause no changes', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  expect(unlockChanges('a', Rating.Again, s, nb)).toEqual([]);
  expect(unlockChanges('a', Rating.Hard, s, nb)).toEqual([]);
  expect(unlockChanges('b', Rating.Good, s, nb)).toEqual([]);
});
