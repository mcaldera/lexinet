import type { NodeState, StateChange } from './unlock';

/**
 * Supply: your words only count while the words around them hold them up.
 *
 * Every word you hold (and isn't broken) sends out supply, more the better you
 * know it (`wordOutput`: its memory strength, plus a verb's tenses); the
 * capital, your home, always sends out 1. Each word's supply flows along links
 * through the words that carry it (held and not broken), and each link passes
 * on as much of it as the link is strong (capped at `maxLink`, so even family
 * links fade). A word gets the shares of all your *other* words added up, each
 * along its best path: a word can't hold itself up, so a lone word is cut off
 * however well you know it, while well-known words around a word hold it up
 * together. A held word with at least `min` is supplied; the rest are cut off
 * and hold out as long as their memory lasts (`advanceSiege`), then fall back
 * to "?". Computed from the states and memory; only the siege clocks are stored.
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
  /**
   * Supply arriving at every word: the shares of all your other words, added up
   * (the capital: its own 1 as well).
   */
  value: Map<string, number>;
  /** The neighbour each word's biggest share comes by: its supply line. */
  from: Map<string, string>;
  /** Per source, the share it sends to the words it reaches (for rerouting). */
  shares: Map<string, Spread>;
};

/**
 * One source's shares: what it sends out, and for each word it reaches (by
 * index into the link graph, itself left out) the share and the neighbour it
 * comes by.
 */
export type Spread = { out: number; idx: Int32Array; v: Float64Array; via: Int32Array };

/** Shares smaller than this are left out: they change nothing and would reach the whole map. */
export const SHARE_MIN = 0.01;

export const linkFactor = (weight: number, maxLink: number) =>
  Math.max(0, Math.min(weight, maxLink));

/** The links as flat arrays (built once per neighbour map): the searches run on these. */
type LinkIndex = {
  ids: string[];
  at: Map<string, number>;
  /** Word i's links are start[i] .. start[i + 1] in `to` and `weight`. */
  start: Int32Array;
  to: Int32Array;
  weight: Float64Array;
  // Scratch space for one search at a time.
  best: Float64Array;
  via: Int32Array;
  done: Uint8Array;
  touched: Int32Array;
  heap: NumHeap;
};
const linkIndexes = new WeakMap<Weighted, LinkIndex>();

function linkIndex(neighbours: Weighted): LinkIndex {
  const known = linkIndexes.get(neighbours);
  if (known) return known;
  const ids: string[] = [];
  const at = new Map<string, number>();
  const add = (id: string) => {
    if (!at.has(id)) at.set(id, ids.push(id) - 1);
  };
  for (const [id, links] of neighbours) {
    add(id);
    for (const l of links) add(l.id);
  }
  const n = ids.length;
  const start = new Int32Array(n + 1);
  for (const [id, links] of neighbours) start[at.get(id)! + 1] = links.length;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const to = new Int32Array(start[n]);
  const weight = new Float64Array(start[n]);
  for (const [id, links] of neighbours) {
    let k = start[at.get(id)!];
    for (const l of links) {
      to[k] = at.get(l.id)!;
      weight[k++] = l.weight;
    }
  }
  const index: LinkIndex = {
    ids,
    at,
    start,
    to,
    weight,
    best: new Float64Array(n),
    via: new Int32Array(n),
    done: new Uint8Array(n),
    touched: new Int32Array(n),
    heap: new NumHeap(),
  };
  linkIndexes.set(neighbours, index);
  return index;
}

/** Which words carry supply (1), per index. */
function carrying(input: SupplyInput, ix: LinkIndex): Uint8Array {
  const flags = new Uint8Array(ix.ids.length);
  for (let i = 0; i < flags.length; i++) flags[i] = input.carries(ix.ids[i]) ? 1 : 0;
  return flags;
}

/**
 * One source's share at every word: a widest-path search from it through the
 * words that carry supply (each link passes on as much as it is strong).
 */
function spread(
  source: string,
  out: number,
  input: SupplyInput,
  ix: LinkIndex,
  carries: Uint8Array,
): Spread {
  const s = ix.at.get(source);
  if (s === undefined || out <= 0) {
    return { out, idx: new Int32Array(0), v: new Float64Array(0), via: new Int32Array(0) };
  }
  const { start, to, weight, best, via, done, touched, heap } = ix;
  const maxLink = input.rules.maxLink;
  const fog = input.fog ?? 0;
  let count = 0;
  best[s] = out;
  touched[count++] = s;
  heap.push(out, s);
  while (heap.size) {
    const v = heap.topKey();
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    // A word outside your hold receives supply but passes none on (or, towards
    // the horizon, only its `fog` share).
    const pass = i === s || carries[i] ? 1 : fog;
    if (pass <= 0) continue;
    for (let k = start[i]; k < start[i + 1]; k++) {
      const j = to[k];
      if (done[j]) continue;
      const w = v * pass * linkFactor(weight[k], maxLink);
      if (w < SHARE_MIN || w <= best[j]) continue;
      if (best[j] === 0) touched[count++] = j;
      best[j] = w;
      via[j] = i;
      heap.push(w, j);
    }
  }
  const idx = new Int32Array(count - 1);
  const v = new Float64Array(count - 1);
  const by = new Int32Array(count - 1);
  for (let c = 1; c < count; c++) {
    const j = touched[c];
    idx[c - 1] = j;
    v[c - 1] = best[j];
    by[c - 1] = via[j];
  }
  for (let c = 0; c < count; c++) {
    best[touched[c]] = 0;
    done[touched[c]] = 0;
  }
  return { out, idx, v, via: by };
}

/** Add the shares up: every word gets those of its other words (the capital its own too). */
function total(shares: Map<string, Spread>, ix: LinkIndex, home?: string): Supply {
  const n = ix.ids.length;
  const sum = new Float64Array(n);
  const biggest = new Float64Array(n);
  const by = new Int32Array(n).fill(-1);
  for (const sp of shares.values()) {
    for (let k = 0; k < sp.idx.length; k++) {
      const i = sp.idx[k];
      sum[i] += sp.v[k];
      if (sp.v[k] > biggest[i]) {
        biggest[i] = sp.v[k];
        by[i] = sp.via[k];
      }
    }
  }
  const value = new Map<string, number>();
  const from = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    if (sum[i] > 0) value.set(ix.ids[i], sum[i]);
    if (by[i] >= 0) from.set(ix.ids[i], ix.ids[by[i]]);
  }
  const own = home === undefined ? undefined : shares.get(home);
  if (home !== undefined && own) value.set(home, (value.get(home) ?? 0) + own.out);
  return { value, from, shares };
}

/**
 * Supply at every word: each source's share along its best path to the word,
 * added up over all sources but the word itself. More words around a word
 * hold it up more; a chain's far end still hangs on the words before it.
 */
export function supplyFlow(input: SupplyInput): Supply {
  const ix = linkIndex(input.neighbours);
  const carries = carrying(input, ix);
  const shares = new Map<string, Spread>();
  for (const [s, out] of input.sources)
    if (out > 0) shares.set(s, spread(s, out, input, ix, carries));
  return total(shares, ix, input.home);
}

export const isSupplied = (supply: Supply, id: string, min: number) =>
  (supply.value.get(id) ?? 0) >= min - 1e-9;

/** Per word (index): the sources whose supply passes on through it. */
const throughs = new WeakMap<Supply, Map<number, string[]>>();
function through(supply: Supply): Map<number, string[]> {
  const known = throughs.get(supply);
  if (known) return known;
  const m = new Map<number, string[]>();
  for (const [s, sp] of supply.shares) {
    const seen = new Set<number>();
    for (let k = 0; k < sp.via.length; k++) {
      const i = sp.via[k];
      if (seen.has(i)) continue;
      seen.add(i);
      const list = m.get(i);
      if (list) list.push(s);
      else m.set(i, [s]);
    }
  }
  throughs.set(supply, m);
  return m;
}

/**
 * `before` once the `gone` words send out and carry nothing any more. `input`
 * must already leave them out (sources and carries). Only the sources whose
 * supply passed on through a gone word are searched again.
 */
function reroute(input: SupplyInput, before: Supply, gone: Iterable<string>): Supply {
  const ix = linkIndex(input.neighbours);
  const via = through(before);
  const shares = new Map(before.shares);
  const again = new Set<string>();
  for (const g of gone) {
    shares.delete(g);
    const i = ix.at.get(g);
    for (const s of (i === undefined ? undefined : via.get(i)) ?? []) again.add(s);
  }
  const carries = again.size ? carrying(input, ix) : new Uint8Array(0);
  for (const s of again) {
    const out = input.sources.get(s);
    if (out === undefined) shares.delete(s);
    else shares.set(s, spread(s, out, input, ix, carries));
  }
  return total(shares, ix, input.home);
}

/**
 * Held words that would be cut off if `id` broke: the words hanging on it
 * (itself not counted). A chokepoint has many; a word with a detour, none.
 * Only words that could drop below `min` are counted again, and only with the
 * sources whose supply passed on through `id`.
 */
export function hanging(
  input: SupplyInput,
  min: number,
  id: string,
  before: Supply = supplyFlow(input),
): string[] {
  const ix = linkIndex(input.neighbours);
  const i = ix.at.get(id);
  const passing = (i === undefined ? undefined : through(before).get(i)) ?? [];
  // At most, a word loses the shares of `id` and of the sources passing through it.
  const left = new Map<number, number>();
  for (const s of new Set([id, ...passing])) {
    const sp = before.shares.get(s);
    if (!sp) continue;
    for (let k = 0; k < sp.idx.length; k++) {
      const j = sp.idx[k];
      left.set(j, (left.get(j) ?? before.value.get(ix.ids[j]) ?? 0) - sp.v[k]);
    }
  }
  const atRisk = new Map(
    [...left].filter(([j, l]) => {
      const x = ix.ids[j];
      return x !== id && input.carries(x) && isSupplied(before, x, min) && l < min - 1e-9;
    }),
  );
  if (!atRisk.size) return [];
  // The sources passing through `id` find their way around it, if there is one.
  const without = { ...input, carries: (x: string) => x !== id && input.carries(x) };
  const carries = carrying(without, ix);
  for (const s of passing) {
    const out = s === id ? undefined : input.sources.get(s);
    if (out === undefined) continue;
    const sp = spread(s, out, without, ix, carries);
    for (let k = 0; k < sp.idx.length; k++) {
      const l = atRisk.get(sp.idx[k]);
      if (l !== undefined) atRisk.set(sp.idx[k], l + sp.v[k]);
    }
  }
  return [...atRisk].filter(([, l]) => l < min - 1e-9).map(([j]) => ix.ids[j]);
}

/** Words a capital on `id` would send at least `min` to if they all carried. */
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
 * changes only when you answer, so it stays fixed in between; each break or
 * fall only reroutes the supply that went through it.
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
  /** Words that send out and carry nothing any more: broken, or fallen. */
  const gone = new Set([...held].filter((id) => world.breakAt(id) <= t));
  const input: SupplyInput = {
    sources: sourcesAt(world, held, t),
    home: world.home,
    carries: (id) => held.has(id) && !gone.has(id),
    neighbours: world.neighbours,
    rules: world.rules,
  };
  let supply = supplyFlow(input);
  for (let guard = 0; guard <= 2 * held.size + 2; guard++) {
    for (const id of held) {
      if (input.carries(id) && isSupplied(supply, id, world.rules.min)) cut.delete(id);
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
    const now: string[] = [];
    for (const id of [...held]) {
      const c = cut.get(id);
      if (c === undefined || c + world.holdMs(id) > t) continue;
      held.delete(id);
      cut.delete(id);
      fallen.push({ id, at: c + world.holdMs(id) });
      if (!gone.has(id)) now.push(id);
      gone.add(id);
    }
    for (const id of input.sources.keys()) {
      if (!gone.has(id) && world.breakAt(id) <= t) {
        now.push(id);
        gone.add(id);
      }
    }
    for (const id of held) {
      if (!gone.has(id) && world.breakAt(id) <= t) {
        now.push(id);
        gone.add(id);
      }
    }
    if (!now.length) continue;
    for (const id of now) input.sources.delete(id);
    if (world.home !== undefined && gone.has(world.home)) input.home = undefined;
    supply = reroute(input, supply, now);
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

/** A binary max-heap of numbers keyed by priority, in flat arrays (the searches' hot loop). */
class NumHeap {
  private keys = new Float64Array(256);
  private vals = new Int32Array(256);
  size = 0;
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (keys[up] >= key) break;
      keys[i] = keys[up];
      vals[i] = vals[up];
      i = up;
    }
    keys[i] = key;
    vals[i] = val;
  }
  topKey() {
    return this.keys[0];
  }
  /** Removes the top and returns its value. */
  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && keys[l + 1] > keys[l] ? l + 1 : l;
        if (keys[c] <= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
