import { appNow } from './clock';
import { buildQueue, closest, nearby, type QueueCard } from './queue';
import { cardId, newCard, rate, Rating, type Direction } from './scheduler';
import type { NodeState } from './unlock';

const t0 = new Date(Date.UTC(2026, 0, 1));
const qc = (nodeId: string, dir: Direction, card = newCard(t0)): QueueCard => ({
  id: cardId(nodeId, dir),
  nodeId,
  card,
});
const states = (o: Record<string, NodeState>) => new Map(Object.entries(o));

test('untouched frontier and locked nodes never appear in the automatic queue', () => {
  const cards = ['a', 'b', 'c'].flatMap((n) => [qc(n, 'it-en'), qc(n, 'en-it')]);
  const q = buildQueue({
    cards,
    states: states({ a: 'frontier', b: 'conquered', c: 'locked' }),
    now: t0,
  });
  expect(q).toEqual([]);
});

test('the unreviewed direction of a started node stays in the queue', () => {
  const cards = [qc('a', 'it-en', rate(newCard(t0), Rating.Easy, t0)), qc('a', 'en-it')];
  const q = buildQueue({
    cards,
    states: states({ a: 'conquered' }),
    now: t0,
  });
  expect(q.map((c) => c.id)).toEqual(['a:en-it']);
});

test('due reviews come first, weakest first', () => {
  const graduate = (days: number) => {
    let c = rate(newCard(t0), Rating.Easy, t0);
    c = rate(c, Rating.Good, c.due);
    return { ...c, due: appNow(-days, t0.getTime()) };
  };
  const weak = graduate(1);
  weak.last_review = appNow(-60, t0.getTime());
  const strong = graduate(1);
  strong.last_review = appNow(-2, t0.getTime());
  const q = buildQueue({
    cards: [qc('s', 'it-en', strong), qc('n', 'it-en'), qc('w', 'it-en', weak)],
    states: states({ s: 'conquered', w: 'conquered', n: 'frontier' }),
    now: t0,
  });
  expect(q.map((c) => c.id)).toEqual(['w:it-en', 's:it-en']);
});

test('a card failed just now is included but not shown twice in a row', () => {
  const failed = rate(newCard(t0), Rating.Again, t0);
  const q = buildQueue({
    cards: [qc('a', 'it-en', failed), qc('a', 'en-it')],
    states: states({ a: 'frontier' }),
    now: new Date(t0.getTime() + 5 * 60_000),
    lastCardId: 'a:it-en',
  });
  expect(q.map((c) => c.id)).toEqual(['a:en-it', 'a:it-en']);
});

test('learning cards wait until they are actually due', () => {
  const learning = rate(newCard(t0), Rating.Good, t0); // due again in minutes
  const q = buildQueue({
    cards: [qc('a', 'it-en', learning)],
    states: states({ a: 'conquered' }),
    now: t0,
  });
  expect(q).toEqual([]);
});

test('nearby keeps the anchor word and its linked words, in queue order', () => {
  const nb = new Map([
    ['a', ['b']],
    ['b', ['a', 'c']],
  ]);
  const q = [{ nodeId: 'c' }, { nodeId: 'b' }, { nodeId: 'z' }, { nodeId: 'a' }];
  expect(nearby(q, 'a', nb).map((c) => c.nodeId)).toEqual(['b', 'a']);
  expect(nearby(q, 'x', nb)).toEqual([]);
  expect(nearby(q, undefined, nb)).toEqual(q);
});

test('closest: the nearest candidate, penalties added to the distance', () => {
  // a - b - c - d
  const nb = new Map([
    ['a', ['b']],
    ['b', ['a', 'c']],
    ['c', ['b', 'd']],
    ['d', ['c']],
  ]);
  expect(
    closest(
      'a',
      nb,
      new Map([
        ['c', 0],
        ['d', 0],
      ]),
    ),
  ).toBe('c');
  expect(
    closest(
      'a',
      nb,
      new Map([
        ['b', 3],
        ['d', 0],
      ]),
    ),
  ).toBe('d');
  expect(
    closest(
      undefined,
      nb,
      new Map([
        ['d', 1],
        ['b', 0],
      ]),
    ),
  ).toBe('b');
  expect(closest('a', nb, new Map())).toBeUndefined();
  // Not linked at all: last resort.
  expect(
    closest(
      'a',
      nb,
      new Map([
        ['z', 0],
        ['d', 5],
      ]),
    ),
  ).toBe('d');
});
