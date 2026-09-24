import { useEffect, type RefObject } from 'react';

type Camera = {
  centerAt(): { x: number; y: number };
  centerAt(x?: number, y?: number, durationMs?: number): unknown;
  zoom(): number;
  zoom(scale: number, durationMs?: number): unknown;
  zoomToFit(durationMs?: number, padding?: number): unknown;
};

const PAN_PX_PER_SEC = 500;
const DIRS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** WASD/arrows pan while held, +/- zoom, F fits; ignored while typing in a field. */
export function useKeyboardCamera(cam: RefObject<Camera | undefined>) {
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
        dx += DIRS[k][0];
        dy += DIRS[k][1];
      }
      const step = (PAN_PX_PER_SEC * dt) / c.zoom(); // screen speed independent of zoom
      const { x, y } = c.centerAt();
      c.centerAt(x + dx * step, y + dy * step);
      frame = requestAnimationFrame(tick);
    };

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const c = cam.current;
      if (k in DIRS) {
        e.preventDefault(); // arrows would otherwise scroll the sidebar
        held.add(k);
        if (!frame) frame = requestAnimationFrame(tick);
      } else if (c && (k === '+' || k === '=')) {
        c.zoom(c.zoom() * 1.25, 150);
      } else if (c && (k === '-' || k === '_')) {
        c.zoom(c.zoom() / 1.25, 150);
      } else if (c && k === 'f') {
        c.zoomToFit(400, 60);
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
