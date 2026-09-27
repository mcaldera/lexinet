// d3-force-3d (installed with react-force-graph) ships no types; only its
// collision force is used directly (views/GraphView.tsx).
declare module 'd3-force-3d' {
  type CollideForce<N> = ((alpha: number) => void) & {
    radius(r: number | ((node: N) => number)): CollideForce<N>;
    strength(s: number): CollideForce<N>;
    iterations(n: number): CollideForce<N>;
  };
  export function forceCollide<N>(radius?: number | ((node: N) => number)): CollideForce<N>;
}
