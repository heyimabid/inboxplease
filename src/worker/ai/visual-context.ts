// A standalone pointer needs its accompanying photo or an explicit product name.
// Keep this narrow so a checkout answer or a named product is never swallowed.
export function isVisualReference(text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => isPointer(line));
}
function isPointer(text: string) {
  const t = text
    .toLowerCase()
    .trim()
    .replace(/[?!।.,]+$/gu, '')
    .trim();
  return /^(?:(?:ei|oi)\s*(?:ta|ṭa)|eta|eita|oita|এটা|এইটা|ওটা|এই\s*টা)(?:\s+(?:ki|কি))?(?:\s+(?:ache|ase|achen|available|nai|nei|আছে|নাই|নেই))?$|^(?:do you have|have you got)\s+(?:this|that)(?:\s+one)?$|^(?:is\s+)?(?:this|that)(?:\s+one)?(?:\s+(?:available|in stock))?$/iu.test(
    t,
  );
}
