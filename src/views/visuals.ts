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
