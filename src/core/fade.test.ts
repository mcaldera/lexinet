import { fadedName, hintedName } from './fade';

test('healthy and unreviewed words keep their full name', () => {
  expect(fadedName('la famiglia', 0.95)).toBe('la famiglia');
  expect(fadedName('la famiglia', null)).toBe('la famiglia');
});

test('letters erode gradually and stably as recall falls from due (90%) to broken (80%)', () => {
  const a = fadedName('la famiglia', 0.87);
  const b = fadedName('la famiglia', 0.83);
  const hiddenCount = (s: string) => [...s].filter((c) => c === '·').length;
  expect(hiddenCount(a)).toBeGreaterThan(0);
  expect(hiddenCount(b)).toBeGreaterThan(hiddenCount(a));
  expect(fadedName('la famiglia', 0.87)).toBe(a); // same every render
  expect(a.length).toBe('la famiglia'.length);
  expect(a[2]).toBe(' '); // spaces are never eroded
  // Letters hidden at 87% stay hidden at 83%.
  [...a].forEach((c, i) => c === '·' && expect(b[i]).toBe('·'));
});

test('a broken word has lost its name entirely', () => {
  expect(fadedName('la famiglia', 0.8)).toBe('');
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
