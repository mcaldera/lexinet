import { useEffect, useRef, type RefObject } from 'react';

type Camera = {
  centerAt(): { x: number; y: number };
  centerAt(x?: number, y?: number, durationMs?: number): unknown;
  zoom(): number;
  zoom(scale: number, durationMs?: number): unknown;
  zoomToFit(durationMs?: number, padding?: number): unknown;
};

const PAN_PX_PER_SEC = 500;
const PAN: Record<string, [number, number]> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
const ARROWS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Controls where arrow keys have their own meaning (dropdowns, multi-line text). */
const ownsArrows = (target: EventTarget | null) =>
  target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

type Options = {
  /** Arrow keys: move the node cursor in a direction (x right, y down). */
  onArrow: (dx: number, dy: number) => void;
  /** Enter / Space outside text fields: open the node under the cursor. */
  onSelect: () => void;
  /** N outside text fields: jump to the next word that needs attention. */
  onNext?: () => void;
  /** R outside text fields: relax the layout. */
  onRelax?: () => void;
};

/**
 * Keyboard map controls. Arrows move the node cursor to a linked word and select
 * it (even while typing an answer: a one-line box has no use for them).
 * WASD pan while held, +/- zoom, F fits, N jumps to the next word needing
 * attention — only outside text fields.
 */
export function useKeyboardCamera(cam: RefObject<Camera | undefined>, options: Options) {
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const held = new Set<string>();
    let frame = 0;
    let last = 0;

    const tick = (t: number) => {
      const c = cam.current;
      const dt = last ? (t - last) / 1000 : 0;
      last = t;
      if (!c || held.size === 0) {
        frame = 0;
        last = 0;
        return;
      }
      let dx = 0;
      let dy = 0;
      for (const k of held) {
        dx += PAN[k][0];
        dy += PAN[k][1];
      }
      const step = (PAN_PX_PER_SEC * dt) / c.zoom(); // screen speed independent of zoom
      const { x, y } = c.centerAt();
      c.centerAt(x + dx * step, y + dy * step);
      frame = requestAnimationFrame(tick);
    };

    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ownsArrows(e.target)) return;
      const k = e.key.toLowerCase();
      if (k in ARROWS) {
        e.preventDefault(); // arrows would otherwise scroll the sidebar
        opts.current.onArrow(...ARROWS[k]);
        return;
      }
      if (isTyping(e.target)) return;
      const c = cam.current;
      if ((k === 'enter' || k === ' ') && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        opts.current.onSelect();
      } else if (k in PAN) {
        held.add(k);
        if (!frame) frame = requestAnimationFrame(tick);
      } else if (c && (k === '+' || k === '=')) {
        c.zoom(c.zoom() * 1.25, 150);
      } else if (c && (k === '-' || k === '_')) {
        c.zoom(c.zoom() / 1.25, 150);
      } else if (c && k === 'f') {
        c.zoomToFit(400, 60);
      } else if (k === 'r') {
        opts.current.onRelax?.();
      } else if (k === 'n') {
        e.preventDefault(); // or the "n" lands in the answer box the jump opens
        opts.current.onNext?.();
      }
    };
    const up = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
    const clear = () => held.clear();

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      cancelAnimationFrame(frame);
    };
  }, [cam]);
}

/**
 * The node to move to from `from` in direction (dx, dy): prefer linked
 * neighbours within 70° of the direction, else the nearest visible node within
 * 45°. Scores favour straight-ahead over near.
 */
export function stepCursor(
  from: { x: number; y: number },
  dx: number,
  dy: number,
  neighbours: { id: string; x: number; y: number }[],
  others: { id: string; x: number; y: number }[],
): string | undefined {
  const pick = (cands: { id: string; x: number; y: number }[], maxDeg: number) => {
    let best: { id: string; score: number } | undefined;
    for (const c of cands) {
      const vx = c.x - from.x;
      const vy = c.y - from.y;
      const dist = Math.hypot(vx, vy);
      if (dist < 1e-6) continue;
      const angle = (Math.acos((vx * dx + vy * dy) / dist) * 180) / Math.PI;
      if (angle > maxDeg) continue;
      const score = angle / maxDeg + dist / 400;
      if (!best || score < best.score) best = { id: c.id, score };
    }
    return best?.id;
  };
  return pick(neighbours, 70) ?? pick(others, 45);
}
