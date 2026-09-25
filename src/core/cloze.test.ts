import { cloze } from './cloze';

test('the gap is the word itself, wherever it stands', () => {
  expect(cloze({ it: 'Il cane abbaia.', en: '', blank: 'cane' })).toEqual({
    before: 'Il ',
    after: ' abbaia.',
  });
  expect(cloze({ it: 'Vino e olio.', en: '', blank: 'Vino' })).toEqual({
    before: '',
    after: ' e olio.',
  });
  expect(cloze({ it: 'Gira a destra.', en: '', blank: 'a destra' })?.before).toBe('Gira ');
});

test('only whole words: no gap inside another word', () => {
  expect(cloze({ it: 'I cani abbaiano.', en: '', blank: 'cane' })).toBeNull();
  expect(cloze({ it: "Voglio l'acqua.", en: '', blank: 'acqua' })).toBeNull();
  expect(cloze({ it: 'È più caro.', en: '', blank: 'più' })?.after).toBe(' caro.');
});
