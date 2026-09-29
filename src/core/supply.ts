import type { NodeState, StateChange } from './unlock';

/**
 * Supply: your words only count while they're connected to a supply node.
 *
 * Every working supply node sends out 1. Supply flows along links through the
 * words that carry it (held and not broken), and each link passes on as much
 * of it as the link is strong (capped at `maxLink`, so even family links fade).
 * A word gets the best of all paths. A held word with at least `min` is
 * supplied; the rest are cut off and hold out as long as their memory lasts
 * (`advanceSiege`), then fall back to "?". Computed from the states; only the
 * siege clocks are stored.
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

export type Weighted = Map<string, { id: string; weight: number }[]>;

export type SupplyInput = {
  /** Working supply nodes: each sends out 1. */
  sources: Iterable<string>;
  /** Words that pass supply on (held and not broken); sources always do. */
  carries: (id: string) => boolean;
  neighbours: Weighted;
  rules: Pick<SupplyRules, 'maxLink'>;
  /** The share other words pass on (0: none; SupplyRules.fog for the horizon). */
  fog?: number;
};

export type Supply = {
  /** Supply arriving at every word it reaches (sources 1). */
  value: Map<string, number>;
  /** The neighbour each word's best supply comes from (unset for sources). */
  from: Map<string, string>;
};

export const linkFactor = (weight: number, maxLink: number) =>
  Math.max(0, Math.min(weight, maxLink));

/** Best supply at every word: a widest-path search from all working sources. */
export function supplyFlow(input: SupplyInput): Supply {
  const value = new Map<string, number>();
  const from = new Map<string, string>();
  const sources = new Set(input.sources);
  const heap = new MaxHeap();
  for (const s of sources) {
    value.set(s, 1);
    heap.push(1, s);
  }
  const done = new Set<string>();
  while (heap.size) {
    const [v, id] = heap.pop();
    if (done.has(id) || v < (value.get(id) ?? 0)) continue;
    done.add(id);
    // A word outside your hold receives supply but passes none on (or, towards
    // the horizon, only its `fog` share).
    const pass = sources.has(id) || input.carries(id) ? 1 : (input.fog ?? 0);
    if (pass <= 0) continue;
    for (const n of input.neighbours.get(id) ?? []) {
      if (done.has(n.id)) continue;
      const next = v * pass * linkFactor(n.weight, input.rules.maxLink);
      if (next > (value.get(n.id) ?? 0)) {
        value.set(n.id, next);
        from.set(n.id, id);
        heap.push(next, n.id);
      }
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
  const after = supplyFlow({
    ...input,
    sources: [...input.sources].filter((s) => s !== id),
    carries: (x) => x !== id && input.carries(x),
  });
  return [...before.value.keys()].filter(
    (x) => x !== id && input.carries(x) && isSupplied(before, x, min) && !isSupplied(after, x, min),
  );
}

/** Words a supply node on `id` would reach with at least `min` if they all carried. */
export function coverage(
  neighbours: Weighted,
  id: string,
  rules: Pick<SupplyRules, 'min' | 'maxLink'>,
  carries: (id: string) => boolean = () => true,
): number {
  const flow = supplyFlow({ sources: [id], carries, neighbours, rules });
  return [...flow.value.keys()].filter((x) => x !== id && isSupplied(flow, x, rules.min)).length;
}

export type SiegeWorld = {
  /** Held (conquered) words. */
  held: Iterable<string>;
  /** Supply nodes: one works from its word while that word isn't broken. */
  nodes: string[];
  neighbours: Weighted;
  /**
   * When a word breaks (app ms): a miss, or its recall falling below the line;
   * Infinity if it won't. For a supply node whose word you lost: 0 (broken);
   * for the capital before it was ever won: Infinity (it works from the start).
   */
  breakAt: (id: string) => number;
  /** How long a cut-off word holds out (ms). */
  holdMs: (id: string) => number;
  rules: SupplyRules;
};

/**
 * Play the siege from `from` to `to`: cut-off words start their clock,
 * supplied ones stop it, and words cut off longer than they hold fall (they
 * leave the held set, which may cut off more). Breaks and falls are handled in
 * time order, so a week away plays out as it would have.
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
      sources: world.nodes.filter((n) => !broken(n)),
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
 * The horizon: hidden words linked to one of your anchors (held words and
 * working supply nodes) become "?", and so do words further out that strong
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

/** A binary max-heap of [priority, id]. */
class MaxHeap {
  private items: [number, string][] = [];
  get size() {
    return this.items.length;
  }
  push(p: number, id: string) {
    const a = this.items;
    a.push([p, id]);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up][0] >= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop(): [number, string] {
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
