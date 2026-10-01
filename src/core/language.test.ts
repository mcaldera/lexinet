import { checkAnswer } from './answer';
import { setLanguage, lang } from './language';
import { newCard, rate, Rating } from './scheduler';
import {
  checkConjugation,
  nextDrill,
  tenseCardId,
  tenses,
  verbLevel,
  type TenseCard,
} from './verbs';

afterEach(() => setLanguage('it'));

const t0 = new Date(Date.UTC(2026, 0, 1));
const learned = (tense: string): TenseCard => ({
  id: tenseCardId('hablar', tense),
  nodeId: 'hablar',
  tense,
  card: rate(newCard(t0), Rating.Easy, t0),
});

test('Italian unless set; an unknown code falls back to Italian', () => {
  expect(lang().code).toBe('it');
  setLanguage('xx');
  expect(lang().code).toBe('it');
});

test('Spanish articles: missing or wrong is "almost", Italian ones mean nothing', () => {
  setLanguage('es');
  const es = (input: string, expected: string) => checkAnswer(input, expected, 'it');
  expect(es('el perro', 'el perro').verdict).toBe('correct');
  expect(es('perro', 'el perro').notes).toEqual(['Article: el perro']);
  expect(es('la perro', 'el perro').verdict).toBe('almost');
  expect(es('las manos', 'las manos').verdict).toBe('correct');
});

test('Spanish accents and ñ count as "almost"', () => {
  setLanguage('es');
  expect(checkAnswer('el nino', 'el niño', 'it').notes).toEqual(['Mind the accent']);
  expect(checkAnswer('habló', 'habló', 'it').verdict).toBe('correct');
  expect(checkAnswer('hablo', 'habló', 'it').verdict).toBe('almost');
});

test('the tense ladder follows the language', () => {
  setLanguage('es');
  expect(nextDrill([], t0)).toEqual({ kind: 'learn', tense: 'presente' });
  expect(verbLevel([learned('presente'), learned('pretérito perfecto')], t0)).toBe(2);
  // Italian tense names don't count in Spanish.
  expect(verbLevel([learned('presente'), learned('passato prossimo')], t0)).toBe(1);
});

test('German: a wrong article is wrong, a missing one almost', () => {
  setLanguage('de');
  const de = (input: string, expected: string) => checkAnswer(input, expected, 'it');
  expect(de('der Hund', 'der Hund').verdict).toBe('correct');
  expect(de('Der hund', 'der Hund').verdict).toBe('correct'); // capitals don't matter
  expect(de('die Hund', 'der Hund')).toMatchObject({
    verdict: 'wrong',
    notes: ['Article: der hund'],
  });
  expect(de('Hund', 'der Hund').verdict).toBe('almost');
});

test('German: ae, oe, ue and ss are right, a plain a is almost', () => {
  setLanguage('de');
  const de = (input: string, expected: string) => checkAnswer(input, expected, 'it');
  expect(de('das Maedchen', 'das Mädchen').verdict).toBe('correct');
  expect(de('die Strasse', 'die Straße').verdict).toBe('correct');
  expect(de('ueber', 'über').verdict).toBe('correct');
  expect(de('das Madchen', 'das Mädchen').notes).toEqual(['Mind the accent']);
});

test('German conjugations accept any listed alternative', () => {
  setLanguage('de');
  const forms = ['würde gehen / ginge', 'würdest gehen / gingest'];
  expect(checkConjugation(['ginge', 'würdest gehen'], forms).grade).toBe(Rating.Good);
  expect(checkConjugation(['ginge', 'gehst'], forms).grade).toBe(Rating.Again);
  expect(tenses()).toHaveLength(5);
});
