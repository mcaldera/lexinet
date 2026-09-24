import { stepCursor } from './useKeyboardCamera';

const at = (id: string, x: number, y: number) => ({ id, x, y });

test('arrow picks the linked neighbour most in that direction', () => {
  const from = { x: 0, y: 0 };
  const nbs = [at('up', 5, -100), at('right', 100, 0), at('upright', 80, -80)];
  expect(stepCursor(from, 0, -1, nbs, [])).toBe('up');
  expect(stepCursor(from, 1, 0, nbs, [])).toBe('right');
});

test('falls back to the nearest visible node when no link points that way', () => {
  const from = { x: 0, y: 0 };
  expect(
    stepCursor(from, 0, 1, [at('up', 0, -100)], [at('far', 0, 300), at('near', 10, 120)]),
  ).toBe('near');
  expect(stepCursor(from, 0, 1, [at('up', 0, -100)], [at('side', 200, 10)])).toBeUndefined();
});
