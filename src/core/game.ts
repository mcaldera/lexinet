import type { Claim } from './claim';

/** The game kept per word on top of its memory (stored as one JSON value, meta `game`). */
export type GameNode = {
  /** Claimed words: progress towards conquest (see core/claim.ts). */
  claim?: Claim;
  /** Won once and lost: a single right answer wins it back for a while (core/fallen.ts). */
  fallen?: { was: 'conquered' | 'claimed'; steps: number; at: number };
  /** A real miss (or an undefended raid) broke this held word until a right answer (app ms). */
  missedAt?: number;
  /** A held word cut off from supply since then (app ms): it falls when it can't hold out. */
  cutSince?: number;
};
/** `simAt`: app time the siege (core/supply.ts advanceSiege) last ran up to. */
export type Game = { simAt: number; nodes: Map<string, GameNode> };

export type Link = { source: string; target: string; weight: number };

/** Every word's links with their strengths, both ways. */
export function neighbourWeights(links: Link[]) {
  const m = new Map<string, { id: string; weight: number }[]>();
  const add = (a: string, b: string, weight: number) =>
    m.set(a, [...(m.get(a) ?? []), { id: b, weight }]);
  for (const l of links) {
    add(l.source, l.target, l.weight);
    add(l.target, l.source, l.weight);
  }
  return m;
}

/** A word's game record without the given fields (undefined ones dropped, to keep saves small). */
export function without(g: GameNode | undefined, ...keys: (keyof GameNode)[]): GameNode {
  const out = { ...g };
  for (const k of keys) delete out[k];
  return out;
}
