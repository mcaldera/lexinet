import { appNow } from './clock';
import { newCard, rate, Rating } from './scheduler';
import {
  checkConjugation,
  nextDrill,
  tenseCardId,
  verbLevel,
  type Tense,
  type TenseCard,
} from './verbs';

const t0 = new Date(Date.UTC(2026, 0, 1));
const learned = (tense: Tense, at = t0): TenseCard => ({
  id: tenseCardId('parlare', tense),
  nodeId: 'parlare',
  tense,
  card: rate(newCard(at), Rating.Easy, at), // graduated straight to review
});

test('level counts consecutive learned tenses and drops when one fades', () => {
  expect(verbLevel([], t0)).toBe(0);
  const cards = [learned('presente'), learned('passato prossimo'), learned('futuro')];
  expect(verbLevel(cards, appNow(0.01, t0.getTime()))).toBe(2); // futuro skipped imperfetto
  expect(verbLevel(cards, appNow(400, t0.getTime()))).toBe(0); // long neglect: faded
});

test('a new tense waits 20 h after the previous one; due tenses come first', () => {
  expect(nextDrill([], t0)).toEqual({ kind: 'learn', tense: 'presente' });
  const pres = learned('presente');
  const soon = nextDrill([pres], appNow(0.5, t0.getTime()));
  expect(soon.kind).toBe('wait');
  expect(nextDrill([pres], appNow(0.9, t0.getTime()))).toMatchObject({
    kind: 'learn',
    tense: 'passato prossimo',
  });
  expect(nextDrill([pres], pres.card.due)).toEqual({ kind: 'defend', tense: 'presente' });
});

test('conjugation check tolerates typos, fails on a wrong form', () => {
  const exp = ['parlo', 'parli', 'parla', 'parliamo', 'parlate', 'parlano'];
  expect(checkConjugation(exp, exp).grade).toBe(Rating.Good);
  const typo = checkConjugation(['parlo', 'parli', 'parla', 'parlamo', 'parlate', 'parlano'], exp);
  expect(typo.grade).toBe(Rating.Hard);
  const wrong = checkConjugation(['parlo', 'parli', 'parla', 'parlo', 'parlate', 'parlano'], exp);
  expect(wrong.grade).toBe(Rating.Again);
  expect(wrong.rows[3]).toBe('wrong');
});
