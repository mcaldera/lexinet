import { attentionList, newlyRevealed } from './attention';
import type { NodeState } from './unlock';

const GAPS = { step: 60_000, recall: 10 * 60_000 };
const t0 = Date.UTC(2026, 0, 1);

test('broken words first (biggest gap first), then open claim steps, then new words', () => {
  const states = new Map<string, NodeState>([
    ['new', 'frontier'],
    ['old', 'frontier'],
    ['small', 'conquered'],
    ['big', 'conquered'],
    ['fine', 'conquered'],
    ['ready', 'claimed'],
    ['waiting', 'claimed'],
    ['hidden', 'locked'],
  ]);
  const list = attentionList({
    states,
    claims: new Map([
      ['ready', { itEn: t0 - 120_000 }],
      ['waiting', { itEn: t0 - 10_000 }],
    ]),
    broken: new Map([
      ['small', 1],
      ['big', 14],
    ]),
    fresh: new Set(['new', 'hidden']),
    nowMs: t0,
    gaps: GAPS,
  });
  expect(list).toEqual([
    { id: 'big', kind: 'broken' },
    { id: 'small', kind: 'broken' },
    { id: 'ready', kind: 'ready' },
    { id: 'new', kind: 'new' },
  ]);
});

test('words under a wrong-answer lock are left out, except broken ones', () => {
  const list = attentionList({
    states: new Map<string, NodeState>([
      ['a', 'frontier'],
      ['b', 'conquered'],
    ]),
    claims: new Map(),
    broken: new Map([['b', 0]]),
    fresh: new Set(['a']),
    nowMs: t0,
    gaps: GAPS,
    blocked: () => true,
  });
  expect(list).toEqual([{ id: 'b', kind: 'broken' }]);
});

test('newly revealed: hidden before, "?" now', () => {
  const before = new Map<string, NodeState>([
    ['a', 'locked'],
    ['b', 'frontier'],
  ]);
  const after = new Map<string, NodeState>([
    ['a', 'frontier'],
    ['b', 'frontier'],
    ['c', 'frontier'],
  ]);
  expect(newlyRevealed(before, after)).toEqual(['a', 'c']);
});

test('held words with a review due are flagged, after open claim steps', () => {
  const list = attentionList({
    states: new Map<string, NodeState>([
      ['w', 'conquered'],
      ['r', 'claimed'],
      ['q', 'frontier'],
    ]),
    claims: new Map([['r', { itEn: t0 - 120_000 }]]),
    fresh: new Set(),
    nowMs: t0,
    gaps: GAPS,
    due: new Set(['w', 'q']),
  });
  expect(list).toEqual([
    { id: 'r', kind: 'ready' },
    { id: 'w', kind: 'due' },
  ]);
});

test('raided words come right after broken ones', () => {
  const list = attentionList({
    states: new Map<string, NodeState>([
      ['a', 'conquered'],
      ['b', 'claimed'],
      ['c', 'conquered'],
    ]),
    claims: new Map([['b', { itEn: 1 }]]),
    broken: new Map([['c', 3]]),
    fresh: new Set(),
    nowMs: 10_000_000,
    gaps: { step: 60_000, recall: 300_000 },
    raid: new Set(['a']),
  });
  expect(list.map((a) => a.kind)).toEqual(['broken', 'raid', 'ready']);
});
