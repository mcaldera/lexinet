import { expeditionStatus, planExpedition } from './expedition';
import type { NodeState } from './unlock';

const regions = [
  { id: 1, words: ['a', 'b', 'c', 'd'] },
  { id: 2, words: ['x', 'y'] },
  { id: 3, words: ['z'] },
];
const states = new Map<string, NodeState>([
  ['a', 'conquered'],
  ['b', 'frontier'],
  ['c', 'frontier'],
  ['x', 'frontier'],
]);
const rules = { minutes: 10, goal: 5 };

test('an expedition goes where there are words to take, capped by what is left', () => {
  const e = planExpedition(regions, states, 1000, rules, () => 0)!;
  expect(e).toMatchObject({
    region: 1,
    goal: 3,
    start: 1000,
    until: 1000 + 600_000,
    before: ['a'],
  });
  // Region 3 has nothing open: never chosen.
  for (const r of [0, 0.5, 0.99])
    expect(planExpedition(regions, states, 0, rules, () => r)?.region).not.toBe(3);
  expect(planExpedition(regions, new Map(), 0, rules)).toBeNull();
});

test('claimed and conquered words count once the expedition started', () => {
  const e = planExpedition(regions, states, 0, rules, () => 0)!;
  const later = new Map(states).set('b', 'claimed').set('c', 'conquered');
  expect(expeditionStatus(e, regions[0].words, later, 1)).toEqual({ taken: 2, state: 'on' });
  expect(expeditionStatus(e, regions[0].words, later, e.until)).toEqual({
    taken: 2,
    state: 'lost',
  });
  later.set('d', 'claimed');
  expect(expeditionStatus(e, regions[0].words, later, e.until)).toEqual({ taken: 3, state: 'won' });
});
