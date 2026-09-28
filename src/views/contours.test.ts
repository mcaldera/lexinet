import { describe, expect, it } from 'vitest';
import { densityField, isoLines, levelAt, loopArea } from './contours';

const bounds = { x0: -100, y0: -100, x1: 100, y1: 100 };

describe('densityField', () => {
  it('peaks at a blob centre and is zero beyond its radius and on the border', () => {
    const f = densityField([{ x: 0, y: 0, r: 40 }], bounds, 5);
    const at = (x: number, y: number) =>
      f.v[Math.round((y - f.y0) / f.cell) * f.cols + Math.round((x - f.x0) / f.cell)];
    expect(at(0, 0)).toBeCloseTo(1);
    expect(at(45, 0)).toBe(0);
    expect(f.v[0]).toBe(0);
  });

  it('adds overlapping blobs up', () => {
    const one = densityField([{ x: 0, y: 0, r: 40 }], bounds, 5);
    const two = densityField(
      [
        { x: 0, y: 0, r: 40 },
        { x: 0, y: 0, r: 40 },
      ],
      bounds,
      5,
    );
    const mid = 20 * one.cols + 20;
    expect(two.v[mid]).toBeCloseTo(2 * one.v[mid]);
  });
});

describe('isoLines', () => {
  it('traces a lone blob as one closed circle at the expected radius', () => {
    const f = densityField([{ x: 0, y: 0, r: 50 }], bounds, 2);
    const loops = isoLines(f, levelAt(0.6));
    expect(loops).toHaveLength(1);
    const p = loops[0];
    for (let k = 0; k < p.length; k += 2) {
      expect(Math.hypot(p[k], p[k + 1])).toBeCloseTo(30, 0);
    }
    expect(Math.abs(loopArea(p))).toBeCloseTo(Math.PI * 30 * 30, -2);
  });

  it('keeps apart blobs apart and merges close ones', () => {
    const far = densityField(
      [
        { x: -60, y: 0, r: 30 },
        { x: 60, y: 0, r: 30 },
      ],
      bounds,
      2,
    );
    expect(isoLines(far, levelAt(0.6))).toHaveLength(2);
    const near = densityField(
      [
        { x: -15, y: 0, r: 30 },
        { x: 15, y: 0, r: 30 },
      ],
      bounds,
      2,
    );
    expect(isoLines(near, levelAt(0.6))).toHaveLength(1);
  });

  it('winds holes against outlines', () => {
    // A ring of blobs leaves a hole in the middle.
    const ring = Array.from({ length: 16 }, (_, k) => ({
      x: 60 * Math.cos((k / 16) * 2 * Math.PI),
      y: 60 * Math.sin((k / 16) * 2 * Math.PI),
      r: 20,
    }));
    const loops = isoLines(densityField(ring, bounds, 2), levelAt(0.6));
    expect(loops).toHaveLength(2);
    const [a, b] = loops.map(loopArea);
    expect(Math.sign(a)).not.toBe(Math.sign(b));
  });

  it('closes loops cut by the field bounds', () => {
    const f = densityField([{ x: 100, y: 0, r: 50 }], bounds, 4);
    const loops = isoLines(f, levelAt(0.6));
    expect(loops).toHaveLength(1);
    expect(Math.max(...Array.from(loops[0]).filter((_, k) => k % 2 === 0))).toBeLessThanOrEqual(
      100,
    );
  });

  it('draws nothing where the field never reaches the level', () => {
    expect(isoLines(densityField([], bounds, 5), 0.3)).toEqual([]);
  });
});
