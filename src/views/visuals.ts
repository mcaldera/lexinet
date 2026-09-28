import type { Edge, EdgeReason, WordNode } from '../db/repo';

/** RGB triplets so opacity can follow node health. */
export const REASON_RGB: Record<EdgeReason, string> = {
  semantic: '56, 189, 248', // sky
  thematic: '148, 163, 184', // slate
  morphological: '167, 139, 250', // violet
  etymological: '244, 114, 182', // pink
};

export const REASON_LABEL: Record<EdgeReason, string> = {
  semantic: 'similar meaning',
  thematic: 'same theme',
  morphological: 'same word family',
  etymological: 'shared root',
};

/** Tree edges this weak exist only to connect two clusters; drawn dashed. */
export const WEAK_LINK = 0.25;
export const isWeakBridge = (e: Pick<Edge, 'weight' | 'via'>) =>
  e.via === 'tree' && e.weight < WEAK_LINK;

export function reasonText(e: Edge, a: WordNode | undefined, b: WordNode | undefined): string {
  if (e.reason === 'thematic' && a?.theme) return `same theme (${a.theme})`;
  if (e.reason === 'etymological' && a?.root) return `shared root: ${a.root}`;
  if (e.reason === 'morphological' && a && b) return 'same word family';
  return REASON_LABEL[e.reason];
}

export type Shape = 'circle' | 'triangle' | 'diamond' | 'square';

export const POS_SHAPE: Record<string, Shape> = {
  noun: 'circle',
  verb: 'triangle',
  adj: 'diamond',
  adjective: 'diamond',
  adv: 'square',
  adverb: 'square',
};

export const shapeOf = (pos: string | null | undefined): Shape =>
  POS_SHAPE[pos?.toLowerCase() ?? ''] ?? 'circle';

/** Add the outline of a shape of "radius" r to the current path. */
export function shapePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  r: number,
) {
  ctx.beginPath();
  switch (shape) {
    case 'triangle': {
      const R = r * 1.3; // triangles look smaller than circles of equal radius
      ctx.moveTo(x, y - R);
      ctx.lineTo(x + R * 0.866, y + R * 0.5);
      ctx.lineTo(x - R * 0.866, y + R * 0.5);
      break;
    }
    case 'diamond': {
      const R = r * 1.25;
      ctx.moveTo(x, y - R);
      ctx.lineTo(x + R, y);
      ctx.lineTo(x, y + R);
      ctx.lineTo(x - R, y);
      break;
    }
    case 'square': {
      const R = r * 0.9;
      ctx.rect(x - R, y - R, 2 * R, 2 * R);
      break;
    }
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
  ctx.closePath();
}

/** Territory colours (RGB): 16 distinct hues, spread so neighbours differ. */
export const REGION_RGB = [
  '96, 165, 250', // blue
  '52, 211, 153', // emerald
  '251, 191, 36', // amber
  '244, 114, 182', // pink
  '167, 139, 250', // violet
  '45, 212, 191', // teal
  '251, 146, 60', // orange
  '248, 113, 113', // red
  '163, 230, 53', // lime
  '56, 189, 248', // sky
  '232, 121, 249', // fuchsia
  '253, 224, 71', // yellow
  '129, 140, 248', // indigo
  '134, 239, 172', // mint
  '253, 164, 175', // rose
  '190, 242, 100', // light lime
];

/**
 * A colour per region such that regions tied by many links (so drawn next to
 * each other) never share one: greedy colouring, biggest regions first, over
 * each region's most-linked neighbours, spreading the palette evenly.
 */
export function regionColors(
  regions: { id: number; words: string[] }[],
  edges: { source: string; target: string; weight: number }[],
  regionOf: (id: string) => number | null | undefined,
  palette = REGION_RGB.length,
  closest = 6,
): Map<number, number> {
  const ties = new Map<number, Map<number, number>>();
  for (const e of edges) {
    const [a, b] = [regionOf(e.source), regionOf(e.target)];
    if (a == null || b == null || a === b) continue;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const m = ties.get(x) ?? new Map<number, number>();
      m.set(y, (m.get(y) ?? 0) + e.weight);
      ties.set(x, m);
    }
  }
  const near = (r: number) =>
    [...(ties.get(r) ?? [])]
      .sort((p, q) => q[1] - p[1])
      .slice(0, closest)
      .map(([id]) => id);
  const color = new Map<number, number>();
  for (const r of [...regions].sort((a, b) => b.words.length - a.words.length)) {
    const taken = new Set<number>();
    for (const n of near(r.id)) if (color.has(n)) taken.add(color.get(n)!);
    // Also avoid regions that list this one among their closest.
    for (const [other, c] of color) if (near(other).includes(r.id)) taken.add(c);
    // The least-used colour that's free, so the whole palette gets used.
    const used = new Map<number, number>();
    for (const c of color.values()) used.set(c, (used.get(c) ?? 0) + 1);
    const free = Array.from({ length: palette }, (_, c) => c).filter((c) => !taken.has(c));
    const pick = (free.length ? free : [0]).reduce((best, c) =>
      (used.get(c) ?? 0) < (used.get(best) ?? 0) ? c : best,
    );
    color.set(r.id, pick);
  }
  return color;
}

/** Health bands of conquered words (see core/health). */
export const BAND_COLOR = {
  solid: 'rgba(52, 211, 153, 1)', // emerald
  faded: 'rgba(52, 211, 153, 0.7)',
  dashed: 'rgba(250, 204, 21, 0.55)', // amber
  cracked: 'rgba(248, 113, 113, 0.85)', // red
} as const;

/** Fonts (bundled, see main.tsx): UI and word names, region names, Latin roots. */
export const FONT_UI = "'Inter Variable', system-ui, sans-serif";
export const FONT_TITLE = "'Cinzel Variable', 'Trajan Pro', Georgia, serif";
export const FONT_LATIN = "'Cormorant Garamond', Georgia, serif";

/** Health band colours as RGB triplets, for gradients (BAND_COLOR is the flat version). */
export const BAND_RGB = {
  solid: '52, 211, 153',
  faded: '45, 185, 135',
  dashed: '250, 204, 21',
  cracked: '248, 113, 113',
} as const;

/** An "r, g, b" triplet moved towards another by k (0 = a, 1 = b). */
export function mixRgb(a: string, b: string, k: number): string {
  const [p, q] = [a, b].map((s) => s.split(',').map(Number));
  return p.map((v, i) => Math.round(v + (q[i] - v) * k)).join(', ');
}
