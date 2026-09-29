import type { NodeState, StateChange } from './unlock';

/**
 * Supply: your words only count while the words around them hold them up.
 *
 * Every word you hold (and isn't broken) sends out supply, more the better you
 * know it (`wordOutput`: its memory strength, plus a verb's tenses); the
 * capital, your home, always sends out 1. Supply flows along links through the
 * words that carry it (held and not broken), and each link passes on as much
 * of it as the link is strong (capped at `maxLink`, so even family links fade).
 * A word gets the best supply from any of your *other* words: a word can't hold
 * itself up, so a lone word is cut off however well you know it, while a few
 * well-known words linked together hold each other (an outpost). A held word
 * with at least `min` is supplied; the rest are cut off and hold out as long as
 * their memory lasts (`advanceSiege`), then fall back to "?". Computed from the
 * states and memory; only the siege clocks are stored.
 */
export type SupplyRules = {
  /** Supply a held word needs to count (and a "?" to lie inside your supply). */
  min: number;
  /** The most a single link passes on, however strong. */
  maxLink: number;
  /** A cut-off word holds out as long as its memory lasts, but at least this long (ms). */
  minHoldMs: number;
  /** Past your words, supply seeps on into unknown land at this share per word... */
  fog: number;
  /** ...and a hidden word it reaches with this much becomes a "?" (the horizon)... */
  reveal: number;
  /** ...or, with this much, a ghost you can see but not conquer yet. */
  sight: number;
};

/** What a word sends out, by memory strength (core/strength levels 0-5) and verb tenses. */
export type OutputRules = {
  /** Output per strength level: a fresh conquest is level 2, a word known for months 5. */
  output: number[];
  /** Added per tense a verb has learned (not faded), up to 1 in all. */
  perTense: number;
};

/** What a held word sends out: more the better you know it. At most 1, like the capital. */
export function wordOutput(level: number, tenses: number, rules: OutputRules): number {
  const base = rules.output[Math.max(0, Math.min(rules.output.length - 1, level))] ?? 0;
  return Math.min(1, base + rules.perTense * tenses);
}

export type Weighted = Map<string, { id: string; weight: number }[]>;

export type SupplyInput = {
  /** Words sending out supply, and how much each sends (at most 1). */
  sources: Map<string, number>;
  /** The capital: supplied by itself in full (every other word only by others). */
  home?: string;
  /** Words that pass supply on (held and not broken); a source always passes its own. */
  carries: (id: string) => boolean;
  neighbours: Weighted;
  rules: Pick<SupplyRules, 'maxLink'>;
  /** The share other words pass on (0: none; SupplyRules.fog for the horizon). */
  fog?: number;
};

export type Supply = {
  /** Supply arriving at every word it reaches from other words (the capital: 1). */
  value: Map<string, number>;
  /** The neighbour each word's best supply comes from (unset for the capital). */
  from: Map<string, string>;
};

export const linkFactor = (weight: number, maxLink: number) =>
  Math.max(0, Math.min(weight, maxLink));

/**
 * Best supply at every word: a widest-path search from all sources at once.
 * Each word keeps the best arrivals of two different sources, so the best one
 * that isn't its own is always among them (a word's own supply echoing back
 * to it through a neighbour doesn't count either).
 */
export function supplyFlow(input: SupplyInput): Supply {
  const value = new Map<string, number>();
  const from = new Map<string, string>();
  const heap = new MaxHeap<{ id: string; origin: string; via?: string }>();
  for (const [s, out] of input.sources) if (out > 0) heap.push(out, { id: s, origin: s });
  /** Per word: the sources whose best arrival it has had (at most two). */
  const settled = new Map<string, string[]>();
  while (heap.size) {
    const [v, { id, origin, via }] = heap.pop();
    const had = settled.get(id) ?? [];
    if (had.length >= 2 || had.includes(origin)) continue;
    settled.set(id, [...had, origin]);
    if (!value.has(id) && (origin !== id || id === input.home)) {
      value.set(id, v);
      if (via) from.set(id, via);
    }
    // A word outside your hold receives supply but passes none on (or, towards
    // the horizon, only its `fog` share).
    const pass = origin === id || input.carries(id) ? 1 : (input.fog ?? 0);
    if (pass <= 0) continue;
    for (const n of input.neighbours.get(id) ?? []) {
      const next = settled.get(n.id);
      if (next && (next.length >= 2 || next.includes(origin))) continue;
      const w = v * pass * linkFactor(n.weight, input.rules.maxLink);
      if (w > 0) heap.push(w, { id: n.id, origin, via: id });
    }
  }
  return { value, from };
}

export const isSupplied = (supply: Supply, id: string, min: number) =>
  (supply.value.get(id) ?? 0) >= min - 1e-9;

/**
 * Held words that would be cut off if `id` broke: the words hanging on it
 * (itself not counted). A chokepoint has many; a word with a detour, none.
 */
export function hanging(
  input: SupplyInput,
  min: number,
  id: string,
  before: Supply = supplyFlow(input),
): string[] {
  const sources = new Map(input.sources);
  sources.delete(id);
  const after = supplyFlow({
    ...input,
    sources,
    carries: (x) => x !== id && input.carries(x),
  });
  return [...before.value.keys()].filter(
    (x) => x !== id && input.carries(x) && isSupplied(before, x, min) && !isSupplied(after, x, min),
  );
}

/** Words a capital on `id` would supply with at least `min` if they all carried. */
export function coverage(
  neighbours: Weighted,
  id: string,
  rules: Pick<SupplyRules, 'min' | 'maxLink'>,
  carries: (id: string) => boolean = () => true,
): number {
  const flow = supplyFlow({ sources: new Map([[id, 1]]), home: id, carries, neighbours, rules });
  return [...flow.value.keys()].filter((x) => x !== id && isSupplied(flow, x, rules.min)).length;
}

export type SiegeWorld = {
  /** Held (conquered) words. */
  held: Iterable<string>;
  /** The capital: it sends out 1 while it isn't broken, and supplies itself. */
  home?: string;
  /** What a held word sends out while it isn't broken (`wordOutput`). */
  output: (id: string) => number;
  neighbours: Weighted;
  /**
   * When a word breaks (app ms): a miss, or its recall falling below the line;
   * Infinity if it won't. For a capital you lost: 0 (broken); for the capital
   * before it was ever won: Infinity (it works from the start).
   */
  breakAt: (id: string) => number;
  /** How long a cut-off word holds out (ms). */
  holdMs: (id: string) => number;
  rules: SupplyRules;
};

/** The words sending out supply at `t` (held, not broken; the capital), and how much. */
export function sourcesAt(world: SiegeWorld, held: Iterable<string>, t: number) {
  const sources = new Map<string, number>();
  for (const id of held) if (world.breakAt(id) > t) sources.set(id, world.output(id));
  if (world.home !== undefined && world.breakAt(world.home) > t) sources.set(world.home, 1);
  return sources;
}

/**
 * Play the siege from `from` to `to`: cut-off words start their clock,
 * supplied ones stop it, and words cut off longer than they hold fall (they
 * leave the held set, which may cut off more). Breaks and falls are handled in
 * time order, so a week away plays out as it would have. What words send out
 * changes only when you answer, so it stays fixed in between.
 */
export function advanceSiege(
  world: SiegeWorld,
  cutSince: Map<string, number>,
  from: number,
  to: number,
): { cutSince: Map<string, number>; fallen: { id: string; at: number }[] } {
  const held = new Set(world.held);
  const cut = new Map([...cutSince].filter(([id]) => held.has(id)));
  const fallen: { id: string; at: number }[] = [];
  let t = Math.min(from, to);
  for (let guard = 0; guard <= 2 * held.size + 2; guard++) {
    const broken = (id: string) => world.breakAt(id) <= t;
    const carries = (id: string) => held.has(id) && !broken(id);
    const supply = supplyFlow({
      sources: sourcesAt(world, held, t),
      home: world.home,
      carries,
      neighbours: world.neighbours,
      rules: world.rules,
    });
    for (const id of held) {
      if (carries(id) && isSupplied(supply, id, world.rules.min)) cut.delete(id);
      else if (!cut.has(id)) cut.set(id, t);
    }
    let next = Infinity;
    for (const id of held) {
      const b = world.breakAt(id);
      if (b > t) next = Math.min(next, b);
      const c = cut.get(id);
      if (c !== undefined) next = Math.min(next, c + world.holdMs(id));
    }
    if (next > to) break;
    t = next;
    for (const id of [...held]) {
      const c = cut.get(id);
      if (c === undefined || c + world.holdMs(id) > t) continue;
      held.delete(id);
      cut.delete(id);
      fallen.push({ id, at: c + world.holdMs(id) });
    }
  }
  return { cutSince: cut, fallen };
}

/**
 * The horizon: hidden words linked to one of your anchors (held words and a
 * working capital) become "?", and so do words further out that strong
 * supply seeps to (`reach` at least `reveal`: supplyFlow with `fog`). "?" left
 * with neither go back to hidden, unless `keep` holds them (started, won back,
 * opened by a root). With nothing left to do, the allowed word nearest to an
 * anchor opens anyway.
 */
export function horizonChanges(
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
  anchors: Set<string>,
  allowed: (id: string) => boolean,
  keep: (id: string) => boolean,
  reach: Map<string, number> = new Map(),
  reveal = Infinity,
): StateChange[] {
  const near = (id: string) =>
    anchors.has(id) ||
    (neighbours.get(id) ?? []).some((n) => anchors.has(n)) ||
    (reach.get(id) ?? 0) >= reveal - 1e-9;
  const changes: StateChange[] = [];
  for (const [id, st] of states) {
    if (st === 'locked' && allowed(id) && near(id)) {
      changes.push({ id, state: 'frontier' });
    } else if (st === 'frontier' && !near(id) && !keep(id)) {
      changes.push({ id, state: 'locked' });
    }
  }
  const opened = new Set(changes.filter((c) => c.state === 'frontier').map((c) => c.id));
  const closed = new Set(changes.filter((c) => c.state === 'locked').map((c) => c.id));
  const busy = [...states].some(
    ([id, st]) => (st === 'frontier' && !closed.has(id)) || st === 'claimed',
  );
  if (!opened.size && !busy) {
    const next = nearestAllowed(states, neighbours, anchors, allowed);
    if (next) changes.push({ id: next, state: 'frontier' });
  }
  return changes;
}

/**
 * Ghosts: hidden words a little supply seeps to (`reach` at least `sight`,
 * below what makes a "?"). You can see them coming but not conquer them yet;
 * with no supply at all a word stays unseen.
 */
export function ghostWords(
  states: Map<string, NodeState>,
  reach: Map<string, number>,
  sight: number,
  allowed: (id: string) => boolean,
): Set<string> {
  const ghosts = new Set<string>();
  for (const [id, v] of reach) {
    if (v >= sight - 1e-9 && states.get(id) === 'locked' && allowed(id)) ghosts.add(id);
  }
  return ghosts;
}

/** The hidden, allowed word fewest links away from an anchor. */
function nearestAllowed(
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
  anchors: Set<string>,
  allowed: (id: string) => boolean,
): string | undefined {
  const seen = new Set(anchors);
  let layer = [...anchors];
  while (layer.length) {
    const next: string[] = [];
    for (const id of layer) {
      for (const n of neighbours.get(id) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (states.get(n) === 'locked' && allowed(n)) return n;
        next.push(n);
      }
    }
    layer = next;
  }
  return undefined;
}

/** A binary max-heap of [priority, item]. */
class MaxHeap<T> {
  private items: [number, T][] = [];
  get size() {
    return this.items.length;
  }
  push(p: number, item: T) {
    const a = this.items;
    a.push([p, item]);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up][0] >= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop(): [number, T] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && a[l][0] > a[m][0]) m = l;
        if (r < a.length && a[r][0] > a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
