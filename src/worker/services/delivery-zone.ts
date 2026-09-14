/** Resolve a stated area to one configured choice; never infer it from a street address. */
export function statedDeliveryZone(text: string, names: string[]): string | null {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.!।?]+$/u, '')
      .trim();
  const source = clean(text);
  // A question or negation is not consent to a delivery area.
  if (/[?？]/u.test(text) || /\b(?:not|noy|noi|na|kothay|which)\b|নয়|নয়|না/u.test(source))
    return null;
  const kind = (s: string) => {
    const inside =
      /\b(?:inside|within) dhaka\b|\bdhaka(?:r)?\s+(?:vitore|bhitore|moddhe|vitor|bhitor)\b|ঢাকার?\s*(?:ভিতরে|ভেতরে|মধ্যে)/u.test(
        s,
      );
    const outside =
      /\boutside dhaka\b|\bdhaka(?:r)?\s+(?:baire|bahire|bahir)\b|ঢাকার?\s*(?:বাইরে|বাহিরে)/u.test(
        s,
      );
    return inside === outside ? null : inside ? 'inside' : 'outside';
  };
  const sourceKind = kind(source);
  const matches = names.filter(
    (name) => source === clean(name) || (sourceKind !== null && sourceKind === kind(clean(name))),
  );
  return matches.length === 1 ? matches[0]! : null;
}
