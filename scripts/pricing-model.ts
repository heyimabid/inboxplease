import { launchPlans } from '../src/shared/pricing';

// Planning assumptions, not measured production usage or an exchange-rate quote.
// September 15, 2026; source links and launch conditions: docs/pricing-model.md.
const usdToBdt = 130;
const inputUsdPerMillion = 0.3;
const outputUsdPerMillion = 2.5;
const extraPhotoInput = 12000;
const extraPhotoOutput = 1000;
const contingency = 1.25;
const infraPerReplyBdt = 0.05;
const fixedPerSellerBdt = 50; // $5 account fee shared by 20 sellers + storage/ops reserve.
const revenueReserve = 0.18; // 3% payment, 10% support, 5% tax/admin placeholders.
const tokensBdt = (input: number, output: number) =>
  ((input * inputUsdPerMillion + output * outputUsdPerMillion) / 1e6) * usdToBdt;

for (const scenario of [
  { name: 'Baseline (all model calls per reply)', input: 18000, output: 1200 },
  { name: 'Heavy usage stress case', input: 48000, output: 2500 },
]) {
  console.log(`\n${scenario.name}: ${scenario.input} input / ${scenario.output} output tokens`);
  console.table(
    launchPlans.map((plan) => {
      const compute =
        (plan.replies * tokensBdt(scenario.input, scenario.output) +
          plan.photoChecks * tokensBdt(extraPhotoInput, extraPhotoOutput)) *
        contingency;
      const cost = compute + plan.replies * infraPerReplyBdt + fixedPerSellerBdt;
      const contribution = plan.priceBdt * (1 - revenueReserve) - cost;
      return {
        plan: plan.id,
        priceBdt: plan.priceBdt,
        replies: plan.replies,
        cloudAndModelBdt: Math.round(cost),
        grossMargin: `${((1 - cost / plan.priceBdt) * 100).toFixed(1)}%`,
        contributionBdt: Math.round(contribution),
        contributionMargin: `${((contribution / plan.priceBdt) * 100).toFixed(1)}%`,
      };
    }),
  );
}
