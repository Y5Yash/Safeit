export function normalizeName(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bp\.\s*s\.?(?=\s|$)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(police station|police post|police chowki|thana|ps)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
