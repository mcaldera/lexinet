/**
 * Territory geometry: a density field of soft circles sampled on a grid, and
 * its iso-lines by marching squares. The lines are closed polygons in the
 * field's own coordinates, so they can be drawn as crisp vector paths at any
 * resolution (the old field was a half-resolution bitmap with jagged edges).
 */

/** A soft circle: full weight at its centre, none beyond `r`. */
export type Blob = { x: number; y: number; r: number };

/** Samples at the grid points x0 + i·cell, y0 + j·cell (i < cols, j < rows). */
export type Field = {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  v: Float32Array;
};

/** Reused between frames: the map redraws up to 60 times a second. */
let scratch = new Float32Array(0);
let nextScratch = new Int32Array(0);
let pointScratch = new Float32Array(0);

/**
 * Sum of the blobs' kernels (1 - d²/r²)³ on a grid over `bounds`. The outer
 * ring of samples is forced to 0, so every iso-line closes even where the
 * bounds cut through a territory (callers pad the bounds past the view).
 * `reuse`: fill the shared buffer (valid until the next call) instead of a new one.
 */
export function densityField(
  blobs: Blob[],
  bounds: { x0: number; y0: number; x1: number; y1: number },
  cell: number,
  reuse = false,
): Field {
  const cols = Math.max(2, Math.ceil((bounds.x1 - bounds.x0) / cell) + 1);
  const rows = Math.max(2, Math.ceil((bounds.y1 - bounds.y0) / cell) + 1);
  const n = cols * rows;
  let v: Float32Array;
  if (reuse) {
    if (scratch.length < n) scratch = new Float32Array(Math.ceil(n * 1.5));
    v = scratch.subarray(0, n);
    v.fill(0);
  } else {
    v = new Float32Array(n);
  }
  const { x0, y0 } = bounds;
  for (const b of blobs) {
    const i0 = Math.max(1, Math.ceil((b.x - b.r - x0) / cell));
    const i1 = Math.min(cols - 2, Math.floor((b.x + b.r - x0) / cell));
    const j0 = Math.max(1, Math.ceil((b.y - b.r - y0) / cell));
    const j1 = Math.min(rows - 2, Math.floor((b.y + b.r - y0) / cell));
    if (i0 > i1 || j0 > j1) continue;
    const inv = 1 / (b.r * b.r);
    for (let j = j0; j <= j1; j++) {
      const dy = y0 + j * cell - b.y;
      const dy2 = dy * dy * inv;
      if (dy2 >= 1) continue;
      const row = j * cols;
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i * cell - b.x;
        const q = 1 - dx * dx * inv - dy2;
        if (q > 0) v[row + i] += q * q * q;
      }
    }
  }
  return { x0, y0, cell, cols, rows, v };
}

/** The level a lone blob's contour sits at `k` × its radius. */
export const levelAt = (k: number) => (1 - k * k) ** 3;

/**
 * Closed iso-lines where the field crosses `level`, as flat [x, y, x, y, ...]
 * loops. Loops run with the inside on one consistent side, so outlines and
 * holes wind oppositely (fill with 'evenodd' or 'nonzero').
 */
export function isoLines(f: Field, level: number): Float32Array[] {
  const { cols, rows, v, x0, y0, cell } = f;
  const keys = 2 * cols * rows;
  if (nextScratch.length < keys) {
    nextScratch = new Int32Array(Math.ceil(keys * 1.5));
    pointScratch = new Float32Array(nextScratch.length * 2);
  }
  const next = nextScratch;
  const pts = pointScratch;
  next.fill(-1, 0, keys);
  // Edge keys: 2·(j·cols + i) is the horizontal edge from grid point (i, j)
  // to (i+1, j); +1 is the vertical edge from (i, j) to (i, j+1).
  const point = (key: number) => {
    const g = key >> 1;
    const i = g % cols;
    const j = (g - i) / cols;
    const a = v[g];
    const b = key & 1 ? v[g + cols] : v[g + 1];
    const t = Math.min(0.999, Math.max(0.001, (level - a) / (b - a)));
    pts[2 * key] = x0 + (i + (key & 1 ? 0 : t)) * cell;
    pts[2 * key + 1] = y0 + (j + (key & 1 ? t : 0)) * cell;
  };
  // Corners of a cell: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
  // Edges: 0 top (0-1), 1 right (1-2), 2 bottom (3-2), 3 left (0-3).
  const CX = [0, 1, 1, 0];
  const CY = [0, 0, 1, 1];
  const edgeKey = (i: number, j: number, e: number) =>
    e === 0
      ? 2 * (j * cols + i)
      : e === 1
        ? 2 * (j * cols + i + 1) + 1
        : e === 2
          ? 2 * ((j + 1) * cols + i)
          : 2 * (j * cols + i) + 1;
  /** The corner two adjacent edges share (edges e and e+1 share corner e+1). */
  const shared = (a: number, b: number) => ((a + 1) % 4 === b ? b : (b + 1) % 4 === a ? a : -1);
  const edgesOf = [
    [3, 0],
    [0, 1],
    [1, 2],
    [2, 3],
  ]; // the two edges touching each corner
  let any = false;
  const link = (i: number, j: number, ea: number, eb: number, inside: boolean[]) => {
    let a = edgeKey(i, j, ea);
    let b = edgeKey(i, j, eb);
    point(a);
    point(b);
    // Orient so the inside is on the left of a -> b (screen coordinates, y down:
    // cross < 0). The reference corner is the one the segment cuts off, if any.
    const c = shared(ea, eb);
    const ref = c < 0 ? 0 : c;
    const rx = (i + CX[ref]) * cell + x0;
    const ry = (j + CY[ref]) * cell + y0;
    const cross =
      (pts[2 * b] - pts[2 * a]) * (ry - pts[2 * a + 1]) -
      (pts[2 * b + 1] - pts[2 * a + 1]) * (rx - pts[2 * a]);
    if (cross < 0 !== inside[ref]) [a, b] = [b, a];
    next[a] = b;
    any = true;
  };
  const inside = [false, false, false, false];
  const c = [0, 0, 0, 0];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const g = j * cols + i;
      // Most cells are wholly inside or outside: decide that without allocating.
      const in0 = v[g] >= level;
      if (
        in0 === v[g + 1] >= level &&
        in0 === v[g + cols + 1] >= level &&
        in0 === v[g + cols] >= level
      ) {
        continue;
      }
      c[0] = v[g];
      c[1] = v[g + 1];
      c[2] = v[g + cols + 1];
      c[3] = v[g + cols];
      for (let k = 0; k < 4; k++) inside[k] = c[k] >= level;
      const crossing: number[] = [];
      for (let e = 0; e < 4; e++) if (inside[e] !== inside[(e + 1) % 4]) crossing.push(e);
      if (crossing.length === 2) {
        link(i, j, crossing[0], crossing[1], inside);
        continue;
      }
      // Saddle: two diagonal corners inside. If the centre is inside they join
      // across it and the segments cut off the outside corners, else the inside ones.
      const centreIn = (c[0] + c[1] + c[2] + c[3]) / 4 >= level;
      for (let k = 0; k < 4; k++) {
        if (inside[k] === centreIn) continue;
        const [ea, eb] = edgesOf[k];
        link(i, j, ea, eb, inside);
      }
    }
  }
  if (!any) return [];
  const loops: Float32Array[] = [];
  for (let start = 0; start < keys; start++) {
    if (next[start] < 0) continue;
    const loop: number[] = [];
    let k = start;
    while (k >= 0 && next[k] >= 0) {
      loop.push(pts[2 * k], pts[2 * k + 1]);
      const n = next[k];
      next[k] = -1;
      k = n;
    }
    if (loop.length >= 6) loops.push(Float32Array.from(loop));
  }
  return loops;
}

/**
 * Add loops to a path as smooth curves: each corner becomes a quadratic
 * curve between the midpoints of its two sides, which hides the grid.
 */
export function traceLoops(path: Path2D | CanvasRenderingContext2D, loops: Float32Array[]) {
  for (const p of loops) {
    const n = p.length / 2;
    const mx = (k: number) => (p[2 * (k % n)] + p[2 * ((k + 1) % n)]) / 2;
    const my = (k: number) => (p[2 * (k % n) + 1] + p[2 * ((k + 1) % n) + 1]) / 2;
    path.moveTo(mx(0), my(0));
    for (let k = 1; k <= n; k++) {
      path.quadraticCurveTo(p[2 * (k % n)], p[2 * (k % n) + 1], mx(k), my(k));
    }
    path.closePath();
  }
}

/** Signed area of a loop (shoelace); the sign tells outlines from holes. */
export function loopArea(p: Float32Array): number {
  let a = 0;
  const n = p.length / 2;
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n;
    a += p[2 * k] * p[2 * l + 1] - p[2 * l] * p[2 * k + 1];
  }
  return a / 2;
}
