const HOUSE_NO_RE = /\b(?:h\.?\s?no\b\.?|house\s+no\b\.?)\s*(?=[\w/-]*\d)[\w/-]+/gi;
/** "s/o Ram Kumar", "r/o Seelampur" … up to the next , . or ; (single-letter initials like "R." are skipped over). */
const RELATION_RE = /\b[sdwr]\/o\b(?:\b[a-z]\.|[^,.;])*/gi;
const NUM = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?';
const AGE_RE = new RegExp(`\\b(?:aged\\s+(?:about\\s+)?${NUM}|${NUM}-(?:and-a-half-)?(?:years?|months?)-old)\\b`, 'gi');

/** Removes personal identifiers (relations, residence, age, house numbers) from a short text. */
export function scrubPii(s: string): string {
  return s
    .replace(HOUSE_NO_RE, '')
    .replace(AGE_RE, '')
    .replace(RELATION_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/,(\s*,)+/g, ',')
    .replace(/,([.;])/g, '$1')
    .trim();
}
