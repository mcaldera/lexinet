import { Rating } from './scheduler';
import { initialStates, neighbourMap, slipChanges, unlockChanges } from './unlock';

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

test('Good on a frontier node claims it (reach decides what it reveals)', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  expect(unlockChanges('a', Rating.Good, s)).toEqual([{ id: 'a', state: 'claimed' }]);
});

test('Again and non-frontier nodes cause no changes; a near miss (Hard) conquers', () => {
  const s = initialStates(['a', 'b', 'c', 'd'], 'a');
  expect(unlockChanges('a', Rating.Again, s)).toEqual([]);
  expect(unlockChanges('a', Rating.Hard, s)[0]).toEqual({ id: 'a', state: 'claimed' });
  expect(unlockChanges('b', Rating.Good, s)).toEqual([]);
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
