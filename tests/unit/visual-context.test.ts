import { it, expect } from 'vitest';
import { isVisualReference } from '../../src/worker/ai/visual-context';
import { classifyImageMatch } from '../../src/worker/ai/image-matching';

it('recognizes standalone photo pointers without consuming checkout or named products', () => {
  for (const text of [
    'eta ki ache?',
    'ei ta ache?',
    'eta nai?',
    'এটা কি আছে?',
    'is this available?',
    'do you have this?',
    'eta ki ache?\nei ta ache?',
  ])
    expect(isVisualReference(text)).toBe(true);
  for (const text of [
    'earbuds ache?',
    'quantity 1',
    'name Abid',
    'confirm',
    'ei ta cancel',
    'human please',
    '',
  ])
    expect(isVisualReference(text)).toBe(false);
});
it('offers another earbud model as an alternative without relaxing identity thresholds', () => {
  const thresholds = { nearDistance: null, probable: null, similar: null };
  expect(
    classifyImageMatch(
      'customer',
      [
        {
          productId: 'earbuds',
          sameProduct: false,
          sameProductType: true,
          score: 0.1,
          evidence: ['Both show earbuds; different cases and models'],
        },
      ],
      thresholds,
    ).kind,
  ).toBe('category_alternatives');
  for (const object of ['USB adapter', 'chicken', 'text screenshot', 'unclear image']) {
    expect(
      classifyImageMatch(
        'customer',
        [
          {
            productId: 'earbuds',
            sameProduct: false,
            sameProductType: false,
            score: 0.99,
            evidence: [object],
          },
        ],
        thresholds,
      ).kind,
    ).toBe('none');
  }
});
