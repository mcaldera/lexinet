import { SUPPLY } from './config';
import { neighbourWeights } from './core/game';
import { forgetAt } from './core/health';
import { nodeStrength } from './core/strength';
import {
  contributions,
  gainIfWon,
  hanging,
  isSupplied,
  sourcesAt,
  supplyFlow,
  wordOutput,
  type Contribution,
  type SiegeWorld,
  type Supply,
  type SupplyInput,
} from './core/supply';
import { verbLevel, type TenseCard } from './core/verbs';
import type { NodeState } from './core/unlock';
import type { AppData, CardRow } from './db/repo';

const DAY = 86_400_000;

export function cardsByNode(cards: CardRow[]) {
  const m = new Map<string, CardRow[]>();
  for (const c of cards) m.set(c.nodeId, [...(m.get(c.nodeId) ?? []), c]);
  return m;
}

/**
 * Everything the siege (core/supply.ts advanceSiege) needs, from the saved
 * game. A word sends out supply by its memory strength and, for a verb, the
 * tenses it has learned as of `t`.
 */
export function siegeWorld(data: AppData, t: number): SiegeWorld {
  const cards = cardsByNode(data.cards);
  const memory = (id: string) => (cards.get(id) ?? []).map((c) => c.card);
  const tenses = new Map<string, TenseCard[]>();
  for (const c of data.tenseCards) tenses.set(c.nodeId, [...(tenses.get(c.nodeId) ?? []), c]);
  const at = new Date(t);
  const held = [...data.states].filter(([, st]) => st === 'conquered').map(([id]) => id);
  return {
    held,
    home: data.seed,
    output: (id) =>
      wordOutput(nodeStrength(memory(id)).level, verbLevel(tenses.get(id) ?? [], at), SUPPLY),
    neighbours: neighbourWeights(data.edges),
    breakAt: (id) => {
      const g = data.game.nodes.get(id);
      if (data.states.get(id) !== 'conquered') {
        // The capital on a word you don't hold: it works before its first
        // conquest; once you've held and lost it, it doesn't.
        return id === data.seed && g?.fallen?.was !== 'conquered' ? Infinity : 0;
      }
      return Math.min(g?.missedAt ?? Infinity, forgetAt(memory(id), SUPPLY.breakRecall));
    },
    holdMs: (id) => Math.max(SUPPLY.minHoldMs, nodeStrength(memory(id)).days * DAY),
    rules: SUPPLY,
  };
}

/** The supply picture at `t`: who sends out what, who's broken, who's cut off. */
export type SupplyNow = {
  /** `input.sources`: what each word sends out now (held and unbroken, the capital while it works). */
  input: SupplyInput;
  flow: Supply;
  /** Held words that are broken (missed, or faded past SUPPLY.breakRecall). */
  broken: Set<string>;
  /** Held words without supply (broken ones included). */
  cut: Set<string>;
  world: SiegeWorld;
};

export function supplyNow(data: AppData, t: number): SupplyNow {
  const world = siegeWorld(data, t);
  const held = new Set(world.held);
  const broken = new Set([...held].filter((id) => world.breakAt(id) <= t));
  const input: SupplyInput = {
    sources: sourcesAt(world, held, t),
    home: world.home,
    carries: (id) => held.has(id) && !broken.has(id),
    neighbours: world.neighbours,
    rules: SUPPLY,
  };
  const flow = supplyFlow(input);
  const cut = new Set(
    [...held].filter((id) => broken.has(id) || !isSupplied(flow, id, SUPPLY.min)),
  );
  return { input, flow, broken, cut, world };
}

/** What a word sends out while it's unbroken (the capital 1). */
export const outputOf = (world: SiegeWorld, id: string) =>
  id === world.home ? 1 : world.output(id);

/** A word sending out full supply (known for months, or a verb with tenses): a stronghold. */
export const isStronghold = (world: SiegeWorld, id: string) =>
  id !== world.home && outputOf(world, id) >= 1 - 1e-9;

/**
 * Supply seeping past your words (fog) from `sources`: the horizon. From every
 * word sending out supply it lights the ground and shows ghosts; the stronger
 * a word, the further it sees.
 */
export function seep(
  s: SupplyNow,
  sources: Map<string, number> = s.input.sources,
): Map<string, number> {
  return supplyFlow({ ...s.input, sources, fog: SUPPLY.fog }).value;
}

/** Held words hanging on `id`: cut off if it broke (for a broken word: what it cuts off now). */
export function hangingOn(s: SupplyNow, id: string): string[] {
  if (!s.broken.has(id)) return hanging(s.input, SUPPLY.min, id, s.flow);
  // Mending it would reconnect these (it sends out supply again, too).
  const repaired = supplyFlow({
    ...s.input,
    sources: new Map([...s.input.sources, [id, outputOf(s.world, id)]]),
    carries: (x) => x === id || s.input.carries(x),
  });
  return [...s.cut].filter(
    (x) => x !== id && !s.broken.has(x) && isSupplied(repaired, x, SUPPLY.min),
  );
}

/** What a word sends out once won: a fresh conquest is strength level 2. */
export const freshOutput = () => wordOutput(2, 0, SUPPLY);

/**
 * Where `id`'s supply comes from (every supplier, biggest first: together they
 * make up its supply), and, while it has less than it needs, what winning each
 * "?" within two links would add to it: how many more words it takes.
 */
export function flowToward(
  s: SupplyNow,
  id: string,
  states: Map<string, NodeState>,
  neighbours: Map<string, string[]>,
): { sources: Contribution[]; gains: Map<string, number> } {
  const sources = contributions(s.input, s.flow, id);
  const gains = new Map<string, number>();
  if (id === s.world.home || isSupplied(s.flow, id, SUPPLY.min)) return { sources, gains };
  const near = new Set<string>();
  for (const a of neighbours.get(id) ?? []) {
    near.add(a);
    for (const b of neighbours.get(a) ?? []) near.add(b);
  }
  for (const c of near) {
    const st = states.get(c);
    if (c === id || (st !== 'frontier' && st !== 'claimed')) continue;
    const gain = gainIfWon(s.input, s.flow, id, c, freshOutput());
    if (gain >= 0.01) gains.set(c, gain);
  }
  return { sources, gains };
}
