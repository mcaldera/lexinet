/**
 * Score: every connected word counts, more the better you know it: 10 points,
 * plus 10 per memory dot (`wordPoints`). Words that are cut off or broken don't
 * count: the caller leaves them out of `states`. Summed per category for the
 * progress panel. Cohesion (links among a category's words / all their links)
 * is still worked out, for two achievements, but no longer weighs the score:
 * the author found the old 10 × words × (1 + 2 × cohesion) opaque (Sep 2026).
 * Computed, never stored.
 */
export type ScoreEdge = { source: string; target: string };
export type ClusterScore = {
  region: number;
  words: number;
  /** Links between two conquered words of this category. */
  inside: number;
  /** Links from its conquered words to words of other categories. */
  outside: number;
  cohesion: number;
  points: number;
};

/** A connected word's points by its memory strength (0-5 dots). */
export const wordPoints = (strength: number) => 10 * (1 + strength);

export function clusterScores(
  states: Map<string, string>,
  edges: ScoreEdge[],
  regionOf: (id: string) => number | undefined,
  /** A conquered word's memory strength (dots). */
  strengthOf: (id: string) => number,
): ClusterScore[] {
  const by = new Map<number, { words: number; inside: number; outside: number; points: number }>();
  const get = (r: number) => {
    let c = by.get(r);
    if (!c) by.set(r, (c = { words: 0, inside: 0, outside: 0, points: 0 }));
    return c;
  };
  for (const [id, st] of states) {
    const r = regionOf(id);
    if (st !== 'conquered' || r === undefined) continue;
    const c = get(r);
    c.words++;
    c.points += wordPoints(strengthOf(id));
  }
  for (const { source: a, target: b } of edges) {
    const [ra, rb] = [regionOf(a), regionOf(b)];
    const [ca, cb] = [states.get(a) === 'conquered', states.get(b) === 'conquered'];
    if (ra === undefined || rb === undefined) continue;
    if (ra === rb) {
      if (ca && cb) get(ra).inside++;
    } else {
      if (ca) get(ra).outside++;
      if (cb) get(rb).outside++;
    }
  }
  return [...by]
    .filter(([, c]) => c.words > 0)
    .map(([region, c]) => {
      const cohesion = c.inside + c.outside ? c.inside / (c.inside + c.outside) : 0;
      return { region, ...c, cohesion };
    })
    .sort((a, b) => b.points - a.points);
}

export const totalScore = (clusters: ClusterScore[]) => clusters.reduce((a, c) => a + c.points, 0);

/** A word's links into its own category and out of it (all words, any state). */
export function wordLinks(
  id: string,
  edges: ScoreEdge[],
  regionOf: (id: string) => number | undefined,
): { inside: number; outside: number } {
  const r = regionOf(id);
  let inside = 0;
  let outside = 0;
  for (const { source, target } of edges) {
    const other = source === id ? target : target === id ? source : null;
    if (other === null) continue;
    if (regionOf(other) === r) inside++;
    else outside++;
  }
  return { inside, outside };
}
