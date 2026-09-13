import { z } from 'zod';
export const ImageMatchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exact_file'),
    productId: z.string(),
    variantId: z.string().optional(),
    evidence: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('near_duplicate'),
    productId: z.string(),
    variantId: z.string().optional(),
    evidence: z.array(z.string()),
    score: z.number(),
  }),
  z.object({
    kind: z.literal('probable_product'),
    productId: z.string(),
    variantId: z.string().optional(),
    evidence: z.array(z.string()),
    score: z.number(),
  }),
  z.object({
    kind: z.literal('similar_products'),
    productIds: z.array(z.string()),
    evidence: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('category_alternatives'),
    productIds: z.array(z.string()),
    evidence: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('uncertain'),
    candidateProductIds: z.array(z.string()),
    reason: z.string(),
  }),
  z.object({ kind: z.literal('none'), reason: z.string() }),
]);
export type ProductImageMatch = z.infer<typeof ImageMatchSchema>;
export type ImageEvidence = {
  productId: string;
  variantId?: string;
  sha256?: string;
  perceptualDistance?: number;
  score?: number;
  sameProduct?: boolean;
  sameProductType?: boolean;
  evidence: string[];
};
export type MatchThresholds = {
  nearDistance: number | null;
  probable: number | null;
  similar: number | null;
};
export function threshold(value: string, min: number, max: number) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max)
    throw new Error('Invalid image threshold');
  return parsed;
}
export function hammingDistance(a: string, b: string) {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return null;
  let bits = BigInt('0x' + a) ^ BigInt('0x' + b),
    count = 0;
  while (bits) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}
export function classifyImageMatch(
  sha256: string,
  candidates: ImageEvidence[],
  thresholds: MatchThresholds,
): ProductImageMatch {
  const exact = candidates.filter((c) => c.sha256 === sha256);
  const exactIds = [...new Set(exact.map((c) => c.productId))];
  if (exactIds.length > 1)
    return {
      kind: 'uncertain',
      candidateProductIds: exactIds,
      reason: 'The same catalog photo is used for multiple products.',
    };
  if (exact.length)
    return {
      kind: 'exact_file',
      productId: exact[0]!.productId,
      variantId: exact[0]!.variantId,
      evidence: ['SHA-256 confirms identical image bytes.'],
    };
  const near = candidates
    .filter(
      (c) =>
        c.sameProduct === true &&
        c.perceptualDistance !== undefined &&
        thresholds.nearDistance !== null &&
        c.perceptualDistance <= thresholds.nearDistance,
    )
    .sort((a, b) => (a.perceptualDistance ?? 64) - (b.perceptualDistance ?? 64));
  if (near.length === 1)
    return {
      kind: 'near_duplicate',
      productId: near[0]!.productId,
      variantId: near[0]!.variantId,
      score: 1 - (near[0]!.perceptualDistance ?? 64) / 64,
      evidence: ['Perceptual image distance is within the configured threshold.'],
    };
  const ranked = candidates
    .filter((c) => c.sameProduct !== false && c.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const probable = ranked.filter(
    (c) => c.sameProduct && thresholds.probable !== null && c.score! >= thresholds.probable,
  );
  if (probable.length === 1)
    return {
      kind: 'probable_product',
      productId: probable[0]!.productId,
      score: probable[0]!.score!,
      evidence: probable[0]!.evidence,
    };
  const similar = ranked.filter(
    (c) => thresholds.similar !== null && c.score! >= thresholds.similar,
  );
  if (similar.length)
    return {
      kind: 'similar_products',
      productIds: [...new Set(similar.map((c) => c.productId))],
      evidence: ['Visual similarity is not proof of product identity.'],
    };
  // Category evidence permits an alternative, never a claim of product identity.
  const alternatives = candidates.filter((c) => c.sameProductType === true);
  if (alternatives.length)
    return {
      kind: 'category_alternatives',
      productIds: [...new Set(alternatives.map((c) => c.productId))],
      evidence: ['Same narrow product type; the photographed model is not verified.'],
    };
  const uncertain = candidates.filter(
    (c) =>
      c.sameProduct === true &&
      c.score !== undefined &&
      (thresholds.similar === null || c.score >= thresholds.similar),
  );
  if (uncertain.length)
    return {
      kind: 'uncertain',
      candidateProductIds: [...new Set(uncertain.map((c) => c.productId))],
      reason: 'These are possible alternatives; the match is not confirmed.',
    };
  return { kind: 'none', reason: 'No reliable catalog match was found.' };
}
