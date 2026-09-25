import { FILL_WEIGHT, plantOptions } from './plant';

const nodes = [
  { id: 'avere', region: 1, tier: 1 },
  { id: 'malato', region: 1, tier: 1 },
  { id: 'medico', region: 1, tier: 2 },
  { id: 'febbre', region: 1, tier: 5 },
  { id: 'soldi', region: 2, tier: 1 },
  { id: 'letto', region: 1, tier: 1 },
];
const states = new Map([
  ['avere', 'conquered'],
  ['malato', 'locked'],
  ['medico', 'locked'],
  ['febbre', 'locked'],
  ['soldi', 'locked'],
  ['letto', 'conquered'],
]);

test('hidden partners, same category first, then other hidden words of the category', () => {
  const opts = plantOptions({
    anchor: 'avere',
    candidates: [
      { id: 'soldi', weight: 0.6, components: { semantic: 0.8, thematic: 0 } },
      { id: 'malato', weight: 0.4, components: { semantic: 0.3, thematic: 1 } },
      { id: 'letto', weight: 0.5 }, // already yours: not an option
    ],
    nodes,
    states,
    neighbours: new Map([['avere', ['malato']]]),
    openTier: 1,
    cost: { base: 5, perTierAhead: 2 },
  });
  // Cheapest first, same category first among equal prices: later levels cost more (febbre is 4 ahead).
  expect(opts).toEqual([
    { id: 'malato', weight: 0.4, reason: 'thematic', sameCategory: true, linked: true, cost: 5 },
    { id: 'soldi', weight: 0.6, reason: 'semantic', sameCategory: false, linked: false, cost: 5 },
    {
      id: 'medico',
      weight: FILL_WEIGHT,
      reason: 'thematic',
      sameCategory: true,
      linked: false,
      cost: 7,
    },
    {
      id: 'febbre',
      weight: FILL_WEIGHT,
      reason: 'thematic',
      sameCategory: true,
      linked: false,
      cost: 13,
    },
  ]);
});
