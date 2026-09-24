import { appNow } from './clock';
import {
  deserializeCard,
  isDue,
  newCard,
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
