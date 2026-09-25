import { Rating } from './scheduler';
import {
  applyChanges,
  initialStates,
  neighbourMap,
  repairStates,
  slipChanges,
  unlockChanges,
} from './unlock';

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
    { id: 'a', state: 'claimed' },
    { id: 'b', state: 'frontier' },
    { id: 'c', state: 'frontier' },
  ]);
  const s2 = applyChanges(s, ch);
  expect(s2.get('d')).toBe('locked');
  // Conquering c reveals d but does not touch a (already conquered).
  expect(unlockChanges('c', Rating.Easy, s2, nb)).toEqual([
    { id: 'c', state: 'claimed' },
    { id: 'd', state: 'frontier' },
  ]);
});

test('Again and non-frontier nodes cause no changes; a near miss (Hard) conquers', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  expect(unlockChanges('a', Rating.Again, s, nb)).toEqual([]);
  expect(unlockChanges('a', Rating.Hard, s, nb)[0]).toEqual({ id: 'a', state: 'claimed' });
  expect(unlockChanges('b', Rating.Good, s, nb)).toEqual([]);
});

test('repair reveals locked neighbours of conquered nodes and restarts empty maps', () => {
  const s = new Map([
    ['a', 'conquered'],
    ['b', 'locked'],
    ['c', 'frontier'],
    ['d', 'locked'],
  ] as const);
  expect(repairStates(s, nb, 'a')).toEqual([{ id: 'b', state: 'frontier' }]);
  const fresh = initialStates(['a', 'b'], 'x');
  fresh.set('a', 'locked');
  expect(repairStates(fresh, nb, 'b')).toEqual([{ id: 'b', state: 'frontier' }]);
});

test('neighbours in closed tiers stay locked until repair runs with the tier open', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  const onlyB = (id: string) => id !== 'c';
  expect(unlockChanges('a', Rating.Good, s, nb, onlyB)).toEqual([
    { id: 'a', state: 'claimed' },
    { id: 'b', state: 'frontier' },
  ]);
  const s2 = applyChanges(s, unlockChanges('a', Rating.Good, s, nb, onlyB));
  expect(repairStates(s2, nb, 'a', onlyB)).toEqual([]);
  expect(repairStates(s2, nb, 'a')).toEqual([{ id: 'c', state: 'frontier' }]);
});

test('a miss makes the word and its claimed neighbours slip back', () => {
  const s = new Map([
    ['a', 'claimed'],
    ['b', 'conquered'],
    ['c', 'claimed'],
    ['d', 'claimed'],
  ] as const);
  // a's neighbours are b and c; d is not adjacent to a.
  expect(slipChanges('a', s, nb)).toEqual([
    { id: 'a', state: 'frontier' },
    { id: 'c', state: 'frontier' },
  ]);
});
