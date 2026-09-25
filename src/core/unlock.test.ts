import { Rating } from './scheduler';
import { initialStates, neighbourMap, unlockChanges } from './unlock';

const edges = [
  { source: 'a', target: 'b' },
  { source: 'a', target: 'c' },
  { source: 'c', target: 'd' },
];

test('neighbour map links both ways', () => {
  const nb = neighbourMap(edges);
  expect(nb.get('a')).toEqual(['b', 'c']);
  expect(nb.get('d')).toEqual(['c']);
});

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
