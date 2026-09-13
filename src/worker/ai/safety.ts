// Applies to rendered seller content too: a stored FAQ cannot authorize collecting credentials.
export function requestsPaymentCredentials(text: string) {
  return (
    /\b(send|share|provide|tell|enter|give)\b.{0,48}\b(otp|pin|password|cvv|full card|card number|card details)\b/is.test(
      text,
    ) ||
    /(ওটিপি|পাসওয়ার্ড|পাসওয়ার্ড|পিন|সিভিভি).{0,32}(দিন|দেন|পাঠান|বলুন|লিখুন)/is.test(text) ||
    /\b(otp|pin|password|cvv)\b\s*(?:ta|number|code)?\s*(?:den|din|pathan|bolun)\b/i.test(text)
  );
}
