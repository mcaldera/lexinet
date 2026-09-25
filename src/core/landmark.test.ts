import { landmarkNeed, landmarks, landmarkWords } from './landmark';
import type { NodeState } from './unlock';

const rules = { share: 0.5, max: 12 };

test('half a category, but never more than 12 words', () => {
  expect(landmarkNeed(11, rules)).toBe(6);
  expect(landmarkNeed(116, rules)).toBe(12);
  expect(landmarkNeed(1, rules)).toBe(1);
});

test('a landmark stands while enough words are held, and shields its category', () => {
  const regions = [
    { id: 1, words: ['a', 'b', 'c', 'd'] },
    { id: 2, words: ['x', 'y'] },
  ];
  const states = new Map<string, NodeState>([
    ['a', 'conquered'],
    ['b', 'conquered'],
    ['c', 'frontier'],
    ['x', 'claimed'],
  ]);
  const built = landmarks(regions, states, rules);
  expect([...built]).toEqual([1]);
  expect(landmarkWords(regions, built)).toEqual(new Set(['a', 'b', 'c', 'd']));
  states.set('b', 'frontier'); // lost one: the landmark falls
  expect(landmarks(regions, states, rules).size).toBe(0);
});
