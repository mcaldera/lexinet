import { checkAnswer, checkMeaning, editDistance } from './answer';
import { Rating } from './scheduler';

const it = (input: string, expected: string) => checkAnswer(input, expected, 'it');
const en = (input: string, expected: string) => checkAnswer(input, expected, 'en');

test('edit distance counts adjacent swaps as one edit', () => {
  expect(editDistance('cane', 'cane')).toBe(0);
  expect(editDistance('cane', 'cnae')).toBe(1);
  expect(editDistance('formaggio', 'formagio')).toBe(1);
});

test('exact answers are correct regardless of case, spacing and punctuation', () => {
  expect(it('  Il  Cane. ', 'il cane')).toEqual({
    verdict: 'correct',
    grade: Rating.Good,
    notes: [],
  });
  expect(en('Dog!', 'dog').verdict).toBe('correct');
});

test('English ignores to/the/a and accepts listed alternatives', () => {
  expect(en('bark', 'to bark').verdict).toBe('correct');
  expect(en('the dog', 'dog').verdict).toBe('correct');
  expect(en('watch', 'to look at / to watch').verdict).toBe('correct');
  expect(en('brak', 'to bark').verdict).toBe('almost'); // swapped letters = one typo
});

test('Italian article mistakes are "almost" with a hint', () => {
  const missing = it('cane', 'il cane');
  expect(missing.verdict).toBe('almost');
  expect(missing.grade).toBe(Rating.Hard);
  expect(missing.notes).toEqual(['Article: il cane']);
  expect(it('la cane', 'il cane').verdict).toBe('almost');
  expect(it("l'acqua", "l'acqua").verdict).toBe('correct');
  expect(it('l’acqua', "l'acqua").verdict).toBe('correct');
});

test('missing accents and small typos are "almost"', () => {
  expect(it('la citta', 'la città').notes).toEqual(['Mind the accent']);
  expect(it('il formagio', 'il formaggio').notes).toEqual(['Small typo']);
  expect(it('abbiare', 'abbaiare').verdict).toBe('almost');
});

test('short words must be exact; different words are wrong', () => {
  expect(it('bero', 'bere').verdict).toBe('almost'); // 4 letters: one typo allowed
  expect(en('cot', 'cat').verdict).toBe('wrong');
  expect(it('il gatto', 'il cane').verdict).toBe('wrong');
  expect(it('', 'il cane').grade).toBe(Rating.Again);
});

test('root meanings accept a matching content word', () => {
  expect(checkMeaning('to cook', 'to cook').verdict).toBe('correct');
  expect(checkMeaning('cook', 'to cook').verdict).toBe('correct');
  expect(checkMeaning('journey', 'provisions for a journey (from via, "road")').verdict).toBe(
    'correct',
  );
  expect(checkMeaning('speech', 'speech, parable').verdict).toBe('correct');
  expect(checkMeaning('the sea', 'to cook').verdict).toBe('wrong');
  expect(checkMeaning('for', 'provisions for a journey').verdict).toBe('wrong');
});
