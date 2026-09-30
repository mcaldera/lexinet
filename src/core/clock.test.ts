import { appNow, DAY_MS, fastRate, startOfDay } from './clock';

test('fastRate runs at full speed unless that lands too soon', () => {
  expect(fastRate(300_000, 0, 60)).toBe(60);
  // 5 min to go, but not within the next 20 s: 15x.
  expect(fastRate(300_000, 20_000, 60)).toBe(15);
  // Real time alone gets there after the minimum: no fast-forward.
  expect(fastRate(10_000, 20_000, 60)).toBe(1);
  expect(fastRate(0, 0, 60)).toBe(1);
});

test('appNow applies the day offset', () => {
  const real = Date.UTC(2026, 0, 1);
  expect(appNow(0, real).getTime()).toBe(real);
  expect(appNow(7, real).getTime()).toBe(real + 7 * DAY_MS);
});

test('startOfDay truncates to local midnight', () => {
  const d = startOfDay(new Date(2026, 0, 1, 15, 30));
  expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([0, 0, 1]);
});
