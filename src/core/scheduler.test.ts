import { appNow } from './clock';
import {
  deserializeCard,
  dueAt,
  isDue,
  newCard,
  recallTime,
  rate,
  Rating,
  retrievability,
  serializeCard,
  State,
} from './scheduler';

const t0 = new Date(Date.UTC(2026, 0, 1));

test('new cards have no retrievability and are due now', () => {
  const c = newCard(t0);
  expect(retrievability(c, t0)).toBeNull();
  expect(isDue(c, t0)).toBe(true);
});

test('rating Good moves a card forward and it decays over time', () => {
  let c = rate(newCard(t0), Rating.Good, t0);
  expect(c.state).not.toBe(State.New);
  expect(c.due.getTime()).toBeGreaterThan(t0.getTime());
  c = rate(c, Rating.Good, c.due);
  const r1 = retrievability(c, appNow(1, c.last_review!.getTime()))!;
  const r30 = retrievability(c, appNow(30, c.last_review!.getTime()))!;
  expect(r1).toBeGreaterThan(r30);
  expect(r30).toBeGreaterThan(0);
});

test('Easy schedules further out than Hard', () => {
  const hard = rate(newCard(t0), Rating.Hard, t0);
  const easy = rate(newCard(t0), Rating.Easy, t0);
  expect(easy.due.getTime()).toBeGreaterThan(hard.due.getTime());
});

test('serialization round-trips dates', () => {
  const c = rate(newCard(t0), Rating.Good, t0);
  const back = deserializeCard(serializeCard(c));
  expect(back.due).toBeInstanceOf(Date);
  expect(back).toEqual(c);
});

test('recallTime finds when a card falls to a given recall', () => {
  const card = rate(newCard(t0), Rating.Good, t0);
  const at80 = recallTime(card, 0.8);
  expect(retrievability(card, new Date(at80))).toBeCloseTo(0.8, 2);
  // At 90% a card has lasted exactly its stability.
  expect(recallTime(card, 0.9) - t0.getTime()).toBeCloseTo(card.stability * 86_400_000, -3);
  expect(recallTime(newCard(t0), 0.9)).toBe(Infinity);
});

test('a card is due once its recall is down to 90%, even if scheduled later', () => {
  // A miss, then right a minute later: stability stays ~0.4 d, but ts-fsrs
  // schedules it days out (its intervals keep again < hard < good a day apart).
  const missed = rate(newCard(t0), Rating.Again, t0);
  const t1 = new Date(t0.getTime() + 60_000);
  const card = rate(missed, Rating.Good, t1);
  expect(card.due.getTime() - t1.getTime()).toBeGreaterThan(2 * 86_400_000);
  expect(dueAt(card)).toBeLessThan(t1.getTime() + 86_400_000);
  expect(isDue(card, new Date(t1.getTime() + 86_400_000))).toBe(true);
});
