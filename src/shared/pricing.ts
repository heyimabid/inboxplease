// Proposed launch offers only. These are not active billing entitlements.
// Keep public prices and the owner cost model on the same source of truth.
export const launchPlans = [
  { id: 'starter', priceBdt: 999, replies: 200, pages: 1, products: 50, photoChecks: 20 },
  { id: 'growth', priceBdt: 2499, replies: 600, pages: 1, products: 200, photoChecks: 60 },
  { id: 'business', priceBdt: 4999, replies: 1200, pages: 3, products: 500, photoChecks: 120 },
] as const;
export type LaunchPlan = (typeof launchPlans)[number];
export const recommendedPlan = (monthlyReplies: number) =>
  launchPlans.find((plan) => plan.replies >= monthlyReplies) ?? null;
