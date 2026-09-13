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
    ['price_question', 'stock_question', 'product_question', 'delivery_question'].includes(
      intent,
    ) && !useMyName(text)
  );
}
export function clarification(text: string) {
  return (
    /^[?？!\s]+$/.test(text) ||
    /^(?:what do you mean|what|bujhini|bujhi nai|মানে|বুঝিনি)[?!\s]*$/iu.test(text.trim())
  );
}
