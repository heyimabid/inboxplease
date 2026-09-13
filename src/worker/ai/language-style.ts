export type Language = 'bangla' | 'banglish' | 'english' | 'mixed' | 'unknown';
export const commerceDictionary: Record<string, string> = {
  dam: 'price',
  daam: 'price',
  koto: 'how much',
  ase: 'available',
  ache: 'available',
  acche: 'available',
  hobe: 'available',
  nibo: 'buy',
  nibO: 'buy',
  'order korbo': 'buy',
  'dhakar vitore': 'inside dhaka',
  'dhakar baire': 'outside dhaka',
  hoodi: 'hoodie',
  hudi: 'hoodie',
  কালো: 'black',
  দাম: 'price',
  সাইজ: 'size',
};
export function normalizeCommerce(text: string, custom: Record<string, string> = {}) {
  let value = text.normalize('NFKC').toLowerCase();
  for (const [word, replacement] of Object.entries({ ...commerceDictionary, ...custom }).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      replacement,
    );
  }
  return value;
}
export function detectLanguage(text: string): Language {
  const bangla = (text.match(/[\u0980-\u09ff]/g) ?? []).length,
    latin = (text.match(/[a-z]/gi) ?? []).length;
  if (bangla && latin > 3) return 'mixed';
  if (bangla) return 'bangla';
  if (
    /\b(dam|daam|koto|ase|ache|acche|nibo|nimu|korbo|apni|eta|ta|hobe|vitore|baire|sathe|bolbo)\b/i.test(
      text,
    )
  )
    return 'banglish';
  if (text.trim().length > 2) return 'english';
  return 'unknown';
}
export function style<T>(
  language: Language,
  choices: { english: T; bangla: T; banglish: T; mixed?: T },
): T {
  return language === 'mixed'
    ? (choices.mixed ?? choices.banglish)
    : language === 'bangla'
      ? choices.bangla
      : language === 'banglish'
        ? choices.banglish
        : choices.english;
}
export function formatMoney(amount: number, currency: string, language: Language = 'english') {
  return new Intl.NumberFormat(language === 'bangla' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
