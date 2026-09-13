// Relevance is checked before facts are offered to the model. Membership in the
// seller's FAQ list alone does not make an answer relevant to this turn.
const stopWords = new Set(
  'what how when where which can could would should do does did is are am be the a an i we you your my me us it this that to on in of for and or have has with please want buy ache ase apnader ki'.split(
    ' ',
  ),
);
function terms(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/cash on delivery|\bcod\b|ক্যাশ অন ডেলিভারি|ক্যাশে|ক্যাশ|নগদ/gu, ' cash payment ')
    .replace(/ডেলিভারি|শিপিং|delivery|shipping|deliver/gu, ' delivery ')
    .replace(/ওয়ারেন্টি|ওয়ারেন্টি|warranty|guarantee/gu, ' warranty ')
    .replace(/পেমেন্ট|payment|\bpay\b/gu, ' payment ')
    .replace(/রিটার্ন|return|exchange/gu, ' return ');
  return new Set(
    normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !stopWords.has(t)),
  );
}
export function relevantFaqs<T extends { question: string; isActive: boolean }>(
  query: string,
  faqs: T[],
): T[] {
  const queryTerms = terms(query);
  return faqs.filter(
    (f) => f.isActive && [...terms(f.question)].some((term) => queryTerms.has(term)),
  );
}
export function isGreeting(text: string) {
  return /^(?:(?:hi|hello|hey|হাই|হ্যালো|সালাম|আসসালামু আলাইকুম)[.!?\s]*)+$/iu.test(text.trim());
}
export function isReplyRepair(text: string) {
  return /(?:same (?:thing|answer|reply)|repeat(?:ing)?|no (?:reply|response|responses)|not (?:replying|responding)|reply (?:nai|nei)|একই (?:কথা|উত্তর)|উত্তর (?:নেই|দিচ্ছেন না))/iu.test(
    text,
  );
}
