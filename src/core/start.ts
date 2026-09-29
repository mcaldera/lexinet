/** Choosing where a new game begins: a category's easiest words, or anywhere. */

type StartWord = { id: string; tier?: number; region?: number | null };
type Link = { source: string; target: string };

/**
 * Words that make a good first word: in a category, from its easiest tier, and
 * linked to at least two other words of that category, which the start opens
 * right away (a lone start leaves nothing to do while its word cools down). `region` limits the choice to one category; without it any will do.
 */
export function startCandidates(nodes: StartWord[], edges: Link[], region?: number): string[] {
  const pool = nodes.filter(
    (n) => n.region != null && (region === undefined || n.region === region),
  );
  if (!pool.length) return [];
  const easiest = Math.min(...pool.map((n) => n.tier ?? 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const open = new Map<string, number>();
  const count = (a: string, b: string) => {
    const [x, y] = [byId.get(a), byId.get(b)];
    if (!x || !y || x.region == null || x.region !== y.region) return;
    open.set(a, (open.get(a) ?? 0) + 1);
  };
  for (const e of edges) {
    count(e.source, e.target);
    count(e.target, e.source);
  }
  const easy = pool.filter((n) => (n.tier ?? 1) === easiest);
  const best = Math.min(2, Math.max(...easy.map((n) => open.get(n.id) ?? 0)));
  return easy.filter((n) => (open.get(n.id) ?? 0) >= best).map((n) => n.id);
}

/** A random first word (see `startCandidates`), or undefined if there is none. */
export function pickStart(
  nodes: StartWord[],
  edges: Link[],
  region?: number,
  random: () => number = Math.random,
): string | undefined {
  const ids = startCandidates(nodes, edges, region);
  return ids.length ? ids[Math.floor(random() * ids.length)] : undefined;
}
