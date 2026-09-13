import { readFileSync } from 'node:fs';
import { z } from 'zod';
const schema = z.array(
  z.object({
    workspaceId: z.string(),
    customerImage: z.string(),
    catalogImage: z.string(),
    sameProduct: z.boolean(),
    score: z.number().min(0).max(1),
    perceptualDistance: z.number().int().min(0).max(64).nullable(),
  }),
);
const file = process.argv[2];
if (!file) throw new Error('Usage: npm run eval:images -- path/to/labeled-pairs.json');
const pairs = schema.parse(JSON.parse(readFileSync(file, 'utf8')));
for (let threshold = 0.5; threshold <= 1; threshold += 0.05) {
  const predicted = pairs.filter((p) => p.score >= threshold),
    correct = predicted.filter((p) => p.sameProduct).length,
    total = pairs.filter((p) => p.sameProduct).length;
  console.log(
    JSON.stringify({
      threshold: Number(threshold.toFixed(2)),
      precision: predicted.length ? correct / predicted.length : null,
      recall: total ? correct / total : null,
      samples: pairs.length,
    }),
  );
}
console.log('Choose thresholds using a held-out seller dataset. No universal default is applied.');
for (let distance = 0; distance <= 16; distance++) {
  const comparable = pairs.filter((p) => p.perceptualDistance !== null);
  const predicted = comparable.filter((p) => p.perceptualDistance! <= distance);
  const correct = predicted.filter((p) => p.sameProduct).length;
  const positives = comparable.filter((p) => p.sameProduct).length;
  console.log(
    JSON.stringify({
      perceptualDistance: distance,
      precision: predicted.length ? correct / predicted.length : null,
      recall: positives ? correct / positives : null,
      samples: comparable.length,
    }),
  );
}
