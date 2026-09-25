/**
 * Planting: spend coins on a conquered word to bring one hidden word of the
 * list next to it, joined by a link you made. Options are the word's strongest
 * partners (from the pipeline) that you can't see yet, then other hidden words
 * of its category. Cheapest first (what you can afford now), and among equal
 * prices same-category ones, since they tighten the cluster.
 * Words from later levels can be planted too (a way ahead), at a higher price.
 */
export type PlantCandidate = {
  id: string;
  weight: number;
  components?: { semantic: number; thematic: number };
};
export type PlantOption = {
  id: string;
  weight: number;
  reason: 'semantic' | 'thematic';
  sameCategory: boolean;
  /** Already linked by the pipeline: planting reveals it, no new link. */
  linked: boolean;
  /** Coins: the base price plus extra per level beyond the open one. */
  cost: number;
};

export type PlantInput = {
  anchor: string;
  candidates: PlantCandidate[];
  nodes: { id: string; region?: number | null; tier?: number }[];
  states: Map<string, string>;
  neighbours: Map<string, string[]>;
  openTier: number;
  /** Price of a word in the open tiers, and the extra per tier beyond. */
  cost: { base: number; perTierAhead: number };
  max?: number;
};

/** Weight of a planted link to a same-category word without a pipeline score. */
export const FILL_WEIGHT = 0.3;

export function plantOptions(input: PlantInput): PlantOption[] {
  const { anchor, candidates, nodes, states, neighbours, openTier, cost } = input;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Independent words (no category, region null in the graph) have no category to share.
  const region = byId.get(anchor)?.region ?? undefined;
  const linked = new Set(neighbours.get(anchor) ?? []);
  const ok = (id: string) => id !== anchor && (states.get(id) ?? 'locked') === 'locked';
  const price = (id: string) =>
    cost.base + cost.perTierAhead * Math.max(0, (byId.get(id)?.tier ?? 1) - openTier);
  const out = new Map<string, PlantOption>();
  for (const c of candidates) {
    if (!ok(c.id)) continue;
    const semantic = c.components?.semantic ?? 0;
    out.set(c.id, {
      id: c.id,
      weight: c.weight,
      reason: semantic >= 0.5 || !c.components?.thematic ? 'semantic' : 'thematic',
      sameCategory: region !== undefined && byId.get(c.id)?.region === region,
      linked: linked.has(c.id),
      cost: price(c.id),
    });
  }
  if (region !== undefined) {
    const fill = nodes
      .filter((n) => n.region === region && ok(n.id) && !out.has(n.id))
      .sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1));
    for (const n of fill) {
      out.set(n.id, {
        id: n.id,
        weight: FILL_WEIGHT,
        reason: 'thematic',
        sameCategory: true,
        linked: linked.has(n.id),
        cost: price(n.id),
      });
    }
  }
  return [...out.values()]
    .sort(
      (a, b) =>
        a.cost - b.cost || Number(b.sameCategory) - Number(a.sameCategory) || b.weight - a.weight,
    )
    .slice(0, input.max ?? 6);
}
