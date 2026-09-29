import { appNow } from './clock';
import { edgeOpacity, forgetAt, healthBand, nodeHealth } from './health';
import { newCard, rate, Rating } from './scheduler';

const t0 = new Date(Date.UTC(2026, 0, 1));

test('health is null until a card is reviewed, then decays', () => {
  const fresh = [newCard(t0), newCard(t0)];
  expect(nodeHealth(fresh, t0)).toBeNull();
  const reviewed = [rate(newCard(t0), Rating.Good, t0), newCard(t0)];
  const soon = nodeHealth(reviewed, appNow(0.01, t0.getTime()))!;
  const later = nodeHealth(reviewed, appNow(60, t0.getTime()))!;
  expect(soon).toBeGreaterThan(0.9);
  expect(later).toBeLessThan(soon);
});

test('health bands: solid until due, then fading until the word breaks', () => {
  expect(healthBand(0.95)).toBe('solid');
  expect(healthBand(0.88)).toBe('faded');
  expect(healthBand(0.82)).toBe('dashed');
  expect(healthBand(0.8)).toBe('cracked');
});

test('the weaker direction decides, and says when the word breaks', () => {
  const strong = rate(newCard(t0), Rating.Easy, t0);
  const weak = rate(newCard(t0), Rating.Hard, t0);
  const later = appNow(3, t0.getTime());
  expect(nodeHealth([strong, weak], later)).toBeCloseTo(nodeHealth([weak], later)!);
  expect(forgetAt([strong, weak], 0.8)).toBe(forgetAt([weak], 0.8));
  expect(forgetAt([newCard(t0)], 0.8)).toBe(Infinity);
});

test('edge opacity is the weaker end', () => {
  expect(edgeOpacity(0.4, 0.9)).toBe(0.4);
  expect(edgeOpacity(null, 0.7)).toBe(0.7);
});
