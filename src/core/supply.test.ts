import {
  advanceSiege,
  contributions,
  coverage,
  gainIfWon,
  ghostWords,
  hanging,
  horizonChanges,
  isSupplied,
  supplyFlow,
  wordOutput,
  type Weighted,
} from './supply';
import type { NodeState } from './unlock';

const RULES = { min: 0.1, maxLink: 0.9, minHoldMs: 1000, fog: 0.6, reveal: 0.08, sight: 0.04 };

/** The capital "s" alone sends out supply. */
const home = { sources: new Map([['s', 1]]), home: 's' };

/** Undirected weighted links "a-b:0.5". */
function net(...links: string[]): Weighted {
  const m: Weighted = new Map();
  const add = (a: string, b: string, weight: number) =>
    m.set(a, [...(m.get(a) ?? []), { id: b, weight }]);
  for (const l of links) {
    const [pair, w] = l.split(':');
    const [a, b] = pair.split('-');
    add(a, b, Number(w));
    add(b, a, Number(w));
  }
  return m;
}

test('supply fades by link strength and takes the best path', () => {
  const n = net('s-a:0.5', 'a-b:0.5', 's-c:0.8', 'c-b:0.8');
  const flow = supplyFlow({ ...home, carries: () => true, neighbours: n, rules: RULES });
  expect(flow.value.get('s')).toBe(1);
  expect(flow.value.get('a')).toBeCloseTo(0.5);
  // Via c (0.8 × 0.8) beats via a (0.5 × 0.5).
  expect(flow.value.get('b')).toBeCloseTo(0.64);
  expect(flow.from.get('b')).toBe('c');
});

test('even the strongest link passes on at most maxLink', () => {
  const n = net('s-a:1', 'a-b:1');
  const flow = supplyFlow({ ...home, carries: () => true, neighbours: n, rules: RULES });
  expect(flow.value.get('b')).toBeCloseTo(0.81);
});

test('only held, unbroken words pass supply on', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const flow = supplyFlow({
    ...home,
    carries: (id) => id !== 'a',
    neighbours: n,
    rules: RULES,
  });
  expect(flow.value.get('a')).toBeCloseTo(0.9); // a receives...
  expect(flow.value.has('b')).toBe(false); // ...but passes nothing on
});

test('words hanging on a chokepoint, none on a word with a detour', () => {
  //  s - a - b - c      (and a detour s - d - b)
  const n = net('s-a:0.9', 'a-b:0.9', 'b-c:0.9', 's-d:0.5', 'd-b:0.5');
  const input = { ...home, carries: () => true, neighbours: n, rules: RULES };
  expect(hanging(input, 0.3, 'b').sort()).toEqual(['c']);
  // b still gets 0.25 via d when a breaks: above 0.2, so nothing hangs on a.
  expect(hanging(input, 0.2, 'a')).toEqual([]);
  // With a higher bar the detour isn't enough.
  expect(hanging(input, 0.3, 'a').sort()).toEqual(['b', 'c']);
});

test('coverage counts what a capital would reach', () => {
  const n = net('s-a:0.5', 'a-b:0.5', 'b-c:0.5');
  expect(coverage(n, 's', { min: 0.2, maxLink: 0.9 })).toBe(2); // a (0.5), b (0.25)
  expect(
    isSupplied({ value: new Map([['x', 0.1]]), from: new Map(), shares: new Map() }, 'x', 0.1),
  ).toBe(true);
});

test('a cut-off word holds out as long as it lasts, then falls', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const breakAt = (id: string) => (id === 'a' ? 100 : Infinity);
  const world = {
    held: ['s', 'a', 'b'],
    home: 's',
    output: () => 0, // only the capital sends supply here
    neighbours: n,
    breakAt,
    holdMs: (id: string) => (id === 'b' ? 500 : 50),
    rules: RULES,
  };
  // Before a breaks, everything is supplied.
  expect(advanceSiege(world, new Map(), 0, 99).cutSince.size).toBe(0);
  // a breaks at 100: a and b are cut off from then on.
  const mid = advanceSiege(world, new Map(), 0, 120);
  expect(mid.cutSince.get('b')).toBe(100);
  expect(mid.fallen.map((f) => f.id)).toEqual([]);
  // a (broken) falls at 150, b holds out until 600.
  const end = advanceSiege(world, mid.cutSince, 120, 1000);
  expect(end.fallen).toEqual([
    { id: 'a', at: 150 },
    { id: 'b', at: 600 },
  ]);
});

test('reconnecting in time stops the clock', () => {
  const n = net('s-a:0.9', 'a-b:0.9');
  const world = {
    held: ['s', 'a', 'b'],
    home: 's',
    output: () => 0, // only the capital sends supply here
    neighbours: n,
    breakAt: () => Infinity, // a was repaired
    holdMs: () => 500,
    rules: RULES,
  };
  const { cutSince, fallen } = advanceSiege(world, new Map([['b', 100]]), 200, 1000);
  expect(cutSince.size).toBe(0);
  expect(fallen).toEqual([]);
});

test('a broken capital stops supplying', () => {
  const n = net('s-a:0.9');
  const world = {
    held: ['s', 'a'],
    home: 's',
    output: () => 0, // only the capital sends supply here
    neighbours: n,
    breakAt: (id: string) => (id === 's' ? 0 : Infinity),
    holdMs: () => 500,
    rules: RULES,
  };
  expect(advanceSiege(world, new Map(), 10, 20).cutSince.get('a')).toBe(10);
});

test('the horizon opens words next to anchors and closes lone "?"', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a']],
    ['x', ['y']],
    ['y', ['x']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'locked'],
    ['b', 'locked'],
    ['x', 'frontier'],
    ['y', 'locked'],
  ]);
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    () => false,
  );
  expect(changes).toContainEqual({ id: 'a', state: 'frontier' });
  expect(changes).toContainEqual({ id: 'x', state: 'locked' });
  expect(changes.some((c) => c.id === 'b')).toBe(false);
  // Kept "?" stay.
  const kept = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    (id) => id === 'x',
  );
  expect(kept.some((c) => c.id === 'x')).toBe(false);
});

test('with nothing to do, the nearest allowed word opens', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'locked'],
    ['b', 'locked'],
  ]);
  // a isn't allowed (a later level): b, two links out, opens instead.
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    (id) => id !== 'a',
    () => false,
  );
  expect(changes).toEqual([{ id: 'b', state: 'frontier' }]);
});

test('ghosts: hidden words a little supply seeps to', () => {
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'frontier'],
    ['b', 'locked'],
    ['c', 'locked'],
    ['x', 'locked'],
  ]);
  const reach = new Map([
    ['s', 1],
    ['a', 0.5],
    ['b', 0.05],
    ['c', 0.01],
    ['x', 0.2],
  ]);
  // c gets almost nothing: unseen. x is from a later level: not shown yet.
  expect([...ghostWords(states, reach, 0.04, (id) => id !== 'x')]).toEqual(['b']);
});

test('towards the horizon, supply seeps on past your words with its fog share', () => {
  const n = net('s-a:0.9', 'a-b:0.9', 'b-c:0.9');
  const flow = supplyFlow({
    ...home,
    carries: (id) => id === 's',
    neighbours: n,
    rules: RULES,
    fog: 0.5,
  });
  expect(flow.value.get('a')).toBeCloseTo(0.9);
  expect(flow.value.get('b')).toBeCloseTo(0.9 * 0.5 * 0.9);
  expect(flow.value.get('c')).toBeCloseTo(0.9 * 0.5 * 0.9 * 0.5 * 0.9);
});

test('strong supply reveals words beyond the first ring', () => {
  const neighbours = new Map([
    ['s', ['a']],
    ['a', ['s', 'b']],
    ['b', ['a', 'c']],
    ['c', ['b']],
  ]);
  const states = new Map<string, NodeState>([
    ['s', 'conquered'],
    ['a', 'frontier'],
    ['b', 'locked'],
    ['c', 'frontier'],
  ]);
  const reach = new Map([
    ['a', 0.9],
    ['b', 0.4],
    ['c', 0.05],
  ]);
  const changes = horizonChanges(
    states,
    neighbours,
    new Set(['s']),
    () => true,
    () => false,
    reach,
    0.3,
  );
  expect(changes).toContainEqual({ id: 'b', state: 'frontier' }); // two links out, strong enough
  expect(changes).toContainEqual({ id: 'c', state: 'locked' }); // too little reaches it
});

test('a word is held up by its other words, never by itself', () => {
  const n = net('a-b:0.5', 'c-d:0.5');
  const flow = supplyFlow({
    sources: new Map([
      ['a', 1],
      ['b', 0.2],
      ['c', 1],
    ]),
    carries: () => true,
    neighbours: n,
    rules: RULES,
  });
  expect(flow.value.get('a')).toBeCloseTo(0.1); // from b, not its own 1
  expect(flow.value.get('b')).toBeCloseTo(0.5);
  expect(flow.from.get('b')).toBe('a');
  // c's supply echoing back through d doesn't hold c up.
  expect(flow.value.has('c')).toBe(false);
  expect(flow.value.get('d')).toBeCloseTo(0.5);
});

test('the shares of all its other words add up', () => {
  //  a - x - b - c   (a strong, b weak, c strong but further)
  const n = net('a-x:0.5', 'x-b:0.5', 'b-c:0.8');
  const flow = supplyFlow({
    sources: new Map([
      ['a', 1],
      ['b', 0.2],
      ['c', 0.9],
    ]),
    carries: () => true,
    neighbours: n,
    rules: RULES,
  });
  // x: a 0.5 + b 0.1 + c via b 0.36.
  expect(flow.value.get('x')).toBeCloseTo(0.96);
  expect(flow.from.get('x')).toBe('a'); // the biggest share comes from a
  // b: c 0.72 + a via x 0.25.
  expect(flow.value.get('b')).toBeCloseTo(0.97);
  // c: b 0.16 + a via x and b 0.2; its own share echoing back doesn't count.
  expect(flow.value.get('c')).toBeCloseTo(0.36);
});

test('what a word sends out grows with memory and tenses, up to 1', () => {
  const rules = { output: [0.05, 0.1, 0.25, 0.4, 0.65, 1], perTense: 0.1 };
  expect(wordOutput(2, 0, rules)).toBe(0.25);
  expect(wordOutput(3, 2, rules)).toBeCloseTo(0.6);
  expect(wordOutput(5, 3, rules)).toBe(1);
  expect(wordOutput(9, 0, rules)).toBe(1);
});

test('linked words you know well hold each other up; fresh ones need help', () => {
  const n = net('a-b:0.5', 'b-c:0.5');
  const flow = (out: number) =>
    supplyFlow({
      sources: new Map(['a', 'b', 'c'].map((id) => [id, out])),
      carries: () => true,
      neighbours: n,
      rules: RULES,
    });
  const held = (f: ReturnType<typeof flow>) =>
    ['a', 'b', 'c'].filter((id) => isSupplied(f, id, 0.5));
  expect(held(flow(0.25))).toEqual([]); // fresh: b gets 0.25, a 0.19
  expect(held(flow(1))).toEqual(['a', 'b', 'c']); // strongholds: b 1, a 0.75
});

test('what hangs on a word: its own supply leaves with it', () => {
  //  s - a - b, a sends out a lot: b depends on it
  const n = net('s-a:0.3', 'a-b:0.5');
  const input = {
    sources: new Map([
      ['s', 1],
      ['a', 0.6],
      ['b', 0.1],
    ]),
    home: 's',
    carries: () => true,
    neighbours: n,
    rules: RULES,
  };
  // b gets 0.3 from a (s via a only 0.15): above 0.2 only while a holds.
  expect(hanging(input, 0.2, 'a')).toEqual(['b']);
  expect(hanging(input, 0.2, 'b')).toEqual([]);
});

test('what hangs on a word: searching again only what reaches it gives the full answer', () => {
  // A small, loopy network with sources of every strength.
  const n = net(
    's-a:0.8',
    'a-b:0.6',
    'b-c:0.7',
    'c-d:0.5',
    'a-e:0.4',
    'e-c:0.9',
    'd-f:0.8',
    'f-g:0.6',
    'g-h:0.5',
    'x-y:0.9',
  );
  const out = [1, 0.25, 0.4, 0.65, 0.1, 1, 0.25, 0.4, 0.65, 0.4, 0.4];
  const ids = ['s', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x', 'y'];
  const input = {
    sources: new Map(ids.map((id, i) => [id, out[i]])),
    home: 's',
    carries: () => true,
    neighbours: n,
    rules: RULES,
  };
  const before = supplyFlow(input);
  for (const id of ids) {
    for (const min of [0.2, 0.5, 0.8]) {
      const sources = new Map(input.sources);
      sources.delete(id);
      const full = supplyFlow({
        ...input,
        sources,
        home: id === 's' ? undefined : 's',
        carries: (x) => x !== id,
      });
      const brute = ids.filter(
        (x) => x !== id && isSupplied(before, x, min) && !isSupplied(full, x, min),
      );
      expect(hanging(input, min, id, before).sort()).toEqual(brute.sort());
    }
  }
});

test.each([11, 23, 37, 51, 77])(
  'the siege reroutes step by step exactly as a full recount would (seed %i)',
  (start) => {
    // A random network, words breaking at random times, each holding out a while.
    let seed = start;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ids = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const links: string[] = [];
    for (let i = 1; i < ids.length; i++) {
      links.push(`${ids[Math.floor(rnd() * i)]}-${ids[i]}:${(0.3 + rnd() * 0.6).toFixed(2)}`);
      if (rnd() < 0.4)
        links.push(`${ids[Math.floor(rnd() * i)]}-${ids[i]}:${(0.3 + rnd() * 0.6).toFixed(2)}`);
    }
    const n = net(...links);
    const out = new Map(ids.map((id) => [id, [0.25, 0.4, 0.65, 1][Math.floor(rnd() * 4)]]));
    const breaks = new Map(
      ids.filter(() => rnd() < 0.3).map((id) => [id, Math.floor(rnd() * 1000)]),
    );
    const hold = new Map(ids.map((id) => [id, 50 + Math.floor(rnd() * 400)]));
    const rules = { ...RULES, min: 0.5 };
    const world = {
      held: ids,
      home: 'w0',
      output: (id: string) => out.get(id) ?? 0,
      neighbours: n,
      breakAt: (id: string) => breaks.get(id) ?? Infinity,
      holdMs: (id: string) => hold.get(id)!,
      rules,
    };
    // The reference: everything counted again at every step.
    const reference = () => {
      const held = new Set(ids);
      const cut = new Map<string, number>();
      const fallen: { id: string; at: number }[] = [];
      let t = 0;
      for (;;) {
        const carries = (id: string) => held.has(id) && world.breakAt(id) > t;
        const sources = new Map([...held].filter(carries).map((id) => [id, world.output(id)]));
        const home = world.breakAt('w0') > t && held.has('w0') ? 'w0' : undefined;
        if (home) sources.set(home, 1);
        const supply = supplyFlow({ sources, home, carries, neighbours: n, rules });
        for (const id of held) {
          if (carries(id) && isSupplied(supply, id, rules.min)) cut.delete(id);
          else if (!cut.has(id)) cut.set(id, t);
        }
        let next = Infinity;
        for (const id of held) {
          if (world.breakAt(id) > t) next = Math.min(next, world.breakAt(id));
          const c = cut.get(id);
          if (c !== undefined) next = Math.min(next, c + hold.get(id)!);
        }
        if (next > 2000) return { cutSince: cut, fallen };
        t = next;
        for (const id of [...held]) {
          const c = cut.get(id);
          if (c === undefined || c + hold.get(id)! > t) continue;
          held.delete(id);
          cut.delete(id);
          fallen.push({ id, at: c + hold.get(id)! });
        }
      }
    };
    const ours = advanceSiege(world, new Map(), 0, 2000);
    const ref = reference();
    expect(ours.fallen).toEqual(ref.fallen);
    expect([...ours.cutSince].sort()).toEqual([...ref.cutSince].sort());
    expect(ref.fallen.length).toBeGreaterThan(0); // the test exercises falls
  },
);

test('where a word’s supply comes from: each supplier’s share and its path', () => {
  //  s - a - b - t, and c - t directly
  const n = net('s-a:0.8', 'a-b:0.8', 'b-t:0.5', 'c-t:0.5');
  const input = {
    sources: new Map([
      ['s', 1],
      ['a', 0.25],
      ['c', 0.4],
      ['t', 0.4],
    ]),
    home: 's',
    carries: () => true,
    neighbours: n,
    rules: RULES,
  };
  const flow = supplyFlow(input);
  const from = contributions(input, flow, 't');
  expect(from.map((c) => c.source)).toEqual(['s', 'c', 'a']);
  expect(from[0]).toMatchObject({ share: expect.closeTo(0.32), path: ['s', 'a', 'b', 't'] });
  expect(from[1]).toMatchObject({ share: expect.closeTo(0.2), path: ['c', 't'] });
  expect(from.reduce((a, c) => a + c.share, 0)).toBeCloseTo(flow.value.get('t')!);
});

test('what winning a nearby word would add, as a full recount says', () => {
  //  s - a - x - t: x not held yet (a "?"), t held but cut off from s
  const n = net('s-a:0.8', 'a-x:0.7', 'x-t:0.6', 'a-t:0.2');
  const held = new Set(['s', 'a', 't']);
  const input = {
    sources: new Map([
      ['s', 1],
      ['a', 0.4],
      ['t', 0.25],
    ]),
    home: 's',
    carries: (id: string) => held.has(id),
    neighbours: n,
    rules: RULES,
  };
  const before = supplyFlow(input);
  const after = supplyFlow({
    ...input,
    sources: new Map(input.sources).set('x', 0.25),
    carries: (id: string) => id === 'x' || held.has(id),
  });
  const gain = gainIfWon(input, before, 't', 'x', 0.25);
  expect(gain).toBeCloseTo(after.value.get('t')! - before.value.get('t')!);
  expect(gain).toBeGreaterThan(0.3); // s and a now reach t through x, and x sends its own
});
