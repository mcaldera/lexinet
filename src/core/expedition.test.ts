import { expeditionStatus, planExpedition } from './expedition';
import type { NodeState } from './unlock';

const regions = [
  { id: 1, words: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  { id: 2, words: ['x', 'y', 'v', 'w'] },
  { id: 3, words: ['z'] },
];
const open = (ids: string[]) => ids.map((id) => [id, 'frontier'] as [string, NodeState]);
const states = new Map<string, NodeState>([
  ['a', 'conquered'],
  ...open(['b', 'c', 'd', 'e', 'f']),
  ...open(['x', 'y', 'v']),
]);
const rules = { minutes: 10, goal: 5, minGoal: 3 };

test('a focus goes where its whole goal is open now', () => {
  for (const r of [0, 0.5, 0.99]) {
    const e = planExpedition(regions, states, 1000, rules, () => r)!;
    expect(e).toMatchObject({
      region: 1,
      goal: 5,
      start: 1000,
      until: 1000 + 600_000,
      before: ['a'],
    });
  }
});

test('with no topic that open, a smaller goal where the most are; none below the minimum', () => {
  const few = new Map(states).set('e', 'locked').set('f', 'locked').set('d', 'locked');
  // Region 1 has 2 open, region 2 has 3: region 2, goal 3 (not its 4 words: one is hidden).
  expect(planExpedition(regions, few, 0, rules, () => 0.9)).toMatchObject({ region: 2, goal: 3 });
  few.set('v', 'locked');
  expect(planExpedition(regions, few, 0, rules)).toBeNull();
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
  later.set('d', 'claimed').set('e', 'claimed').set('f', 'claimed');
  expect(expeditionStatus(e, regions[0].words, later, e.until)).toEqual({ taken: 5, state: 'won' });
});
