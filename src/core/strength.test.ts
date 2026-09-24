import { appNow } from './clock';
import { newCard, rate, Rating } from './scheduler';
import { nextPractice, nodeStrength } from './strength';

const t0 = new Date(Date.UTC(2026, 0, 1));

test('strength is 0 for new words and grows only with spaced reviews', () => {
  expect(nodeStrength([newCard(t0)]).level).toBe(0);
  // Cramming: ten Good ratings in a row on the same day.
  let crammed = rate(newCard(t0), Rating.Good, t0);
  for (let i = 0; i < 10; i++) crammed = rate(crammed, Rating.Good, t0);
  // Spaced: review each time it is due.
  let spaced = rate(newCard(t0), Rating.Good, t0);
  for (let i = 0; i < 4; i++) spaced = rate(spaced, Rating.Good, spaced.due);
  expect(nodeStrength([spaced]).level).toBeGreaterThan(nodeStrength([crammed]).level);
  expect(nodeStrength([spaced]).level).toBeGreaterThanOrEqual(3);
});

test('practice waits until a card is due, unless a direction is unreviewed', () => {
  const a = rate(newCard(t0), Rating.Easy, t0);
  const b = rate(newCard(t0), Rating.Easy, t0);
  expect(nextPractice([a, newCard(t0)], t0)).toBeNull();
  const next = nextPractice([a, b], t0)!;
  expect(next.getTime()).toBe(Math.min(a.due.getTime(), b.due.getTime()));
  expect(nextPractice([a, b], appNow(30, t0.getTime()))).toBeNull();
});
