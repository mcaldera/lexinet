import { calendar, dayKey, streak } from './streak';

const today = new Date(2026, 8, 25, 15); // a Friday
const act = (...days: number[]) =>
  new Map(days.map((d) => [dayKey(new Date(2026, 8, d)), 3] as [string, number]));

test('a streak counts back from today', () => {
  expect(streak(act(23, 24, 25), today)).toMatchObject({ current: 3, playedToday: true });
});

test('not played yet today: yesterday keeps the streak alive', () => {
  expect(streak(act(23, 24), today)).toMatchObject({ current: 2, playedToday: false });
  expect(streak(act(22, 23), today).current).toBe(0);
});

test('best is the longest run ever', () => {
  expect(streak(act(1, 2, 3, 4, 10, 24, 25), today)).toMatchObject({ current: 2, best: 4 });
});

test('the calendar is weeks of Monday..Sunday ending with this week', () => {
  const cal = calendar(act(22, 25), today, 2);
  expect(cal).toHaveLength(2);
  expect(cal[1][0]).toEqual({ key: '2026-09-21', count: 0 }); // Monday
  expect(cal[1][1]).toEqual({ key: '2026-09-22', count: 3 });
  expect(cal[1][4]).toEqual({ key: '2026-09-25', count: 3 }); // today, Friday
  expect(cal[1][5]).toBeNull(); // Saturday is still to come
  expect(cal[0][0]?.key).toBe('2026-09-14');
});
