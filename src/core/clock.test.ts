import { appNow, DAY_MS, startOfDay } from './clock';

test('appNow applies the day offset', () => {
  const real = Date.UTC(2026, 0, 1);
  expect(appNow(0, real).getTime()).toBe(real);
  expect(appNow(7, real).getTime()).toBe(real + 7 * DAY_MS);
});

test('startOfDay truncates to local midnight', () => {
  const d = startOfDay(new Date(2026, 0, 1, 15, 30));
  expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([0, 0, 1]);
});
