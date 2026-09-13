import { it, expect } from 'vitest';
import { classifyImageMatch, hammingDistance } from '../../src/worker/ai/image-matching';
import { validateImage } from '../../src/worker/services/images';
import { trustedAttachmentUrl } from '../../src/worker/ai/image-understanding';
const disabled = { nearDistance: null, probable: null, similar: null };
it('only classifies exact files from matching SHA-256 values', () => {
  expect(
    classifyImageMatch('abc', [{ productId: 'p', sha256: 'abc', score: 0, evidence: [] }], disabled)
      .kind,
  ).toBe('exact_file');
  expect(
    classifyImageMatch(
      'abc',
      [{ productId: 'p', sha256: 'def', score: 1, sameProduct: true, evidence: [] }],
      disabled,
    ).kind,
  ).toBe('uncertain');
});
it('keeps shared catalog photos ambiguous and respects calibrated thresholds', () => {
  expect(
    classifyImageMatch(
      'a',
      [
        { productId: 'p', sha256: 'a', evidence: [] },
        { productId: 'q', sha256: 'a', evidence: [] },
      ],
      disabled,
    ).kind,
  ).toBe('uncertain');
  expect(
    classifyImageMatch(
      'a',
      [{ productId: 'p', score: 0.9, sameProduct: true, evidence: ['matching stitching'] }],
      { ...disabled, probable: 0.85 },
    ).kind,
  ).toBe('probable_product');
  expect(classifyImageMatch('a', [], disabled).kind).toBe('none');
  expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
});
it('rejects spoofed MIME types and non-Meta attachment URLs', () => {
  expect(() => validateImage(new TextEncoder().encode('<script>').buffer, 'image/png')).toThrow();
  for (const url of [
    'http://scontent.fbcdn.net/image',
    'https://fbcdn.net.evil.test/image',
    'https://127.0.0.1/image',
    'https://user:password@scontent.fbcdn.net/image',
  ])
    expect(() => trustedAttachmentUrl(url)).toThrow();
  expect(trustedAttachmentUrl('https://scontent.xx.fbcdn.net/image').hostname).toBe(
    'scontent.xx.fbcdn.net',
  );
});

it('produces a bounded delivery raster while retaining original input bytes', async () => {
  const { encode, decode } = await import('fast-png');
  const { deliveryImage } = await import('../../src/worker/services/image-delivery');
  const original = new Uint8Array(
    encode({ width: 1200, height: 2, channels: 4, data: new Uint8Array(1200 * 2 * 4).fill(150) }),
  ).buffer;
  const copy = original.slice(0);
  const result = deliveryImage(original, 'image/png');
  expect(decode(new Uint8Array(result.bytes)).width).toBe(1024);
  expect(new Uint8Array(original)).toEqual(new Uint8Array(copy));
});

it.each(['USB adapter', 'chicken meal'])(
  'rejects an incompatible %s even with one candidate and a hash collision',
  () => {
    expect(
      classifyImageMatch(
        'customer',
        [
          {
            productId: 'earbuds',
            sha256: 'catalog',
            sameProduct: false,
            score: 0.99,
            perceptualDistance: 0,
            evidence: ['Different product types'],
          },
        ],
        { nearDistance: 4, probable: 0.8, similar: 0.6 },
      ).kind,
    ).toBe('none');
  },
);
it('does not turn mere retrieval or a low comparison score into a possible match', () => {
  for (const candidate of [
    { productId: 'earbuds', evidence: [] },
    { productId: 'earbuds', score: 0.05, sameProduct: false, evidence: [] },
  ]) {
    expect(classifyImageMatch('customer', [candidate], disabled).kind).toBe('none');
  }
});
