import { attentionList, newlyRevealed } from './attention';
import type { NodeState } from './unlock';

const GAPS = { step: 60_000, recall: 10 * 60_000 };
const t0 = Date.UTC(2026, 0, 1);

test('open claim steps first, then threats, then freshly revealed words', () => {
  const states = new Map<string, NodeState>([
    ['new', 'frontier'],
    ['old', 'frontier'],
    ['angry', 'frontier'],
    ['fading', 'conquered'],
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
    health: new Map([
      ['fading', 0.6],
      ['fine', 0.95],
    ]),
    hostile: new Set(['angry']),
    fresh: new Set(['new', 'hidden']),
    nowMs: t0,
    gaps: GAPS,
  });
  expect(list).toEqual([
    { id: 'ready', kind: 'ready' },
    { id: 'angry', kind: 'threat' },
    { id: 'fading', kind: 'threat' },
    { id: 'new', kind: 'new' },
  ]);
});

test('words under a wrong-answer lock are left out', () => {
  const list = attentionList({
    states: new Map([['a', 'frontier']]),
    claims: new Map(),
    health: new Map(),
    hostile: new Set(['a']),
    fresh: new Set(),
    nowMs: t0,
    gaps: GAPS,
    blocked: (id) => id === 'a',
  });
  expect(list).toEqual([]);
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

test('a miss flags the endangered claims and the word to win back first', () => {
  const list = attentionList({
    states: new Map<string, NodeState>([
      ['x', 'frontier'],
      ['a', 'claimed'],
      ['r', 'claimed'],
    ]),
    claims: new Map([['r', { itEn: t0 - 120_000 }]]),
    health: new Map(),
    hostile: new Set(['x']),
    fresh: new Set(),
    nowMs: t0,
    gaps: GAPS,
    blocked: (id) => id === 'x',
    danger: new Map([['a', { from: 'x' }]]),
  });
  expect(list).toEqual([
    { id: 'x', kind: 'danger' },
    { id: 'a', kind: 'danger' },
    { id: 'r', kind: 'ready' },
  ]);
});
