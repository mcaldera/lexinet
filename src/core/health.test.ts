import { appNow } from './clock';
import { edgeOpacity, healthBand, nodeHealth } from './health';
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

test('health bands follow the proposal thresholds', () => {
  expect(healthBand(0.95)).toBe('solid');
  expect(healthBand(0.8)).toBe('faded');
  expect(healthBand(0.6)).toBe('dashed');
  expect(healthBand(0.3)).toBe('cracked');
});

test('edge opacity is the weaker end', () => {
  expect(edgeOpacity(0.4, 0.9)).toBe(0.4);
  expect(edgeOpacity(null, 0.7)).toBe(0.7);
});
