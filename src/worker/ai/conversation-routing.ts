import type { CustomerIntent } from './schemas';
export function useMyName(text: string) {
  return /^(?:(?:amr|amar|am[ai]r|my|আমার)\s*(?:name|nam|নাম)(?:\s*(?:e|ei|এ|hobe|হবে|ই))*|(?:use\s+)?my\s+(?:facebook\s+)?name|আমার নামেই)[.!\s]*$/iu.test(
    text.trim(),
  );
}
export function catalogBrowse(text: string) {
  return /\b(?:ki\s*ki|ki ki|what|which|show|list|boltesi).{0,40}\b(?:products?|ponn[oay]|items?|sell|collection)\b|\b(?:products?|ponno|items?)\b.{0,30}\b(?:ache|ase|have|available)\b|কী কী|কি কি.*(?:পণ্য|আছে)/iu.test(
    text,
  );
}
export function shoppingQuestion(text: string, intent: CustomerIntent['intent']) {
  if (catalogBrowse(text)) return true;
  if (/^(?:name|phone|address|delivery area|area|zone)\s*[:=]/iu.test(text)) return false;
  return (
    [
      'product_search',
      'price_question',
      'stock_question',
      'product_question',
      'delivery_question',
    ].includes(intent) && !useMyName(text)
  );
}
export function clarification(text: string) {
  return (
    /^[?？!\s]+$/.test(text) ||
    /^(?:what do you mean|what|bujhini|bujhi nai|মানে|বুঝিনি)[?!\s]*$/iu.test(text.trim())
  );
}

export function orderStatusQuestion(text: string) {
  return /(?:order|অর্ডার).{0,40}(?:status|confirm.*(?:hoise|hoyeche|hoyese|holo|ki)|ki.*confirm|হয়েছে|হয়েছে|অবস্থা)|(?:is|was|has).{0,20}(?:my|the) order|(?:where|kothay|কোথায়).{0,20}(?:order|অর্ডার)/iu.test(
    text,
  );
}
export function asksForReview(text: string) {
  return /(?:show|see|dekhao|dekhabo|দেখাও).{0,20}(?:summary|details|order)|(?:summary|সারাংশ|বিবরণ)/iu.test(
    text,
  );
}
