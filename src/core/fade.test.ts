import { fadedName, hintedName } from './fade';

test('healthy and unreviewed words keep their full name', () => {
  expect(fadedName('la famiglia', 0.95)).toBe('la famiglia');
  expect(fadedName('la famiglia', null)).toBe('la famiglia');
});

test('letters erode gradually and stably as health falls', () => {
  const a = fadedName('la famiglia', 0.8);
  const b = fadedName('la famiglia', 0.6);
  const hiddenCount = (s: string) => [...s].filter((c) => c === '·').length;
  expect(hiddenCount(a)).toBeGreaterThan(0);
  expect(hiddenCount(b)).toBeGreaterThan(hiddenCount(a));
  expect(fadedName('la famiglia', 0.8)).toBe(a); // same every render
  expect(a.length).toBe('la famiglia'.length);
  expect(a[2]).toBe(' '); // spaces are never eroded
  // Letters hidden at 80% stay hidden at 60%.
  [...a].forEach((c, i) => c === '·' && expect(b[i]).toBe('·'));
});

test('badly faded words lose their name entirely', () => {
  expect(fadedName('la famiglia', 0.5)).toBe('');
  expect(fadedName('la famiglia', 0.2)).toBe('');
});

test('a word about to be asked into Italian shows only a few letters', () => {
  const name = hintedName('il marito', null, true);
  const shown = [...name].filter((c) => /\p{L}/u.test(c)).length;
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(4);
  expect(hintedName('il marito', 0.3, true)).toBe(''); // fading further still wins
  expect(hintedName('il marito', 0.95, false)).toBe('il marito');
});
