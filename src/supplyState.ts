import { SUPPLY } from './config';
import { neighbourWeights } from './core/game';
import { forgetAt } from './core/health';
import { nodeStrength } from './core/strength';
import {
  hanging,
  isSupplied,
  supplyFlow,
  type SiegeWorld,
  type Supply,
  type SupplyInput,
} from './core/supply';
import type { AppData, CardRow } from './db/repo';

const DAY = 86_400_000;

/** Your supply nodes: the capital (your start word) and the ones you placed. */
export const supplyNodes = (data: AppData) => [
  data.seed,
  ...data.supplyNodes.filter((id) => id !== data.seed),
];

/** Supply nodes earned so far, the capital included: one more every SUPPLY.every words held. */
export const nodesEarned = (bestHeld: number) => 1 + Math.floor(bestHeld / SUPPLY.every);

/** Supply nodes earned and not placed yet. */
export const nodesToPlace = (data: AppData) =>
  Math.max(0, nodesEarned(data.bestHeld) - supplyNodes(data).length);

export function cardsByNode(cards: CardRow[]) {
  const m = new Map<string, CardRow[]>();
  for (const c of cards) m.set(c.nodeId, [...(m.get(c.nodeId) ?? []), c]);
  return m;
}

/** Everything the siege (core/supply.ts advanceSiege) needs, from the saved game. */
export function siegeWorld(data: AppData): SiegeWorld {
  const cards = cardsByNode(data.cards);
  const memory = (id: string) => (cards.get(id) ?? []).map((c) => c.card);
  const held = [...data.states].filter(([, st]) => st === 'conquered').map(([id]) => id);
  return {
    held,
    nodes: supplyNodes(data),
    neighbours: neighbourWeights(data.edges),
    breakAt: (id) => {
      const g = data.game.nodes.get(id);
      if (data.states.get(id) !== 'conquered') {
        // A supply node on a word you don't hold: the capital works before its
        // first conquest; once you've held and lost it (or any other node), it doesn't.
        return id === data.seed && g?.fallen?.was !== 'conquered' ? Infinity : 0;
      }
      return Math.min(g?.missedAt ?? Infinity, forgetAt(memory(id), SUPPLY.breakRecall));
    },
    holdMs: (id) => Math.max(SUPPLY.minHoldMs, nodeStrength(memory(id)).days * DAY),
    rules: SUPPLY,
  };
}

/** The supply picture at `t`: who carries, who's broken, who's cut off. */
export type SupplyNow = {
  input: SupplyInput;
  flow: Supply;
  /** Held words that are broken (missed, or faded past SUPPLY.breakRecall). */
  broken: Set<string>;
  /** Held words without supply (broken ones included). */
  cut: Set<string>;
  /** Supply nodes working now. */
  working: Set<string>;
  world: SiegeWorld;
};

export function supplyNow(data: AppData, t: number): SupplyNow {
  const world = siegeWorld(data);
  const held = new Set(world.held);
  const broken = new Set([...held].filter((id) => world.breakAt(id) <= t));
  const working = new Set(world.nodes.filter((n) => world.breakAt(n) > t));
  const input: SupplyInput = {
    sources: working,
    carries: (id) => held.has(id) && !broken.has(id),
    neighbours: world.neighbours,
    rules: SUPPLY,
  };
  const flow = supplyFlow(input);
  const cut = new Set(
    [...held].filter((id) => broken.has(id) || !isSupplied(flow, id, SUPPLY.min)),
  );
  return { input, flow, broken, cut, working, world };
}

/** Held words hanging on `id`: cut off if it broke (for a broken word: what it cuts off now). */
export function hangingOn(s: SupplyNow, id: string): string[] {
  if (!s.broken.has(id)) return hanging(s.input, SUPPLY.min, id, s.flow);
  // Repairing it would reconnect these.
  const repaired = supplyFlow({
    ...s.input,
    carries: (x) => x === id || s.input.carries(x),
  });
  return [...s.cut].filter(
    (x) => x !== id && !s.broken.has(x) && isSupplied(repaired, x, SUPPLY.min),
  );
}

/**
 * Supply with one more node on `id`: held words it would reconnect (`gained`),
 * words it would bring inside your supply (`reach`), held words it would
 * strengthen a lot (`stronger`: +20 points or more), and the map.
 */
export function previewNode(s: SupplyNow, id: string) {
  const flow = supplyFlow({ ...s.input, sources: [...s.working, id] });
  const before = (x: string) => s.flow.value.get(x) ?? 0;
  const gained = [...s.cut].filter(
    (x) => !s.broken.has(x) && isSupplied(flow, x, SUPPLY.min),
  ).length;
  const reach = [...flow.value].filter(
    ([x, v]) => v >= SUPPLY.min - 1e-9 && before(x) < SUPPLY.min - 1e-9,
  ).length;
  const stronger = [...flow.value].filter(
    ([x, v]) => x !== id && s.input.carries(x) && v - before(x) >= 0.2,
  ).length;
  return { flow, gained, reach, stronger };
}
