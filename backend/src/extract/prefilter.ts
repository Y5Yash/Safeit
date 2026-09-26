import { classify } from '../config/categories.js';

const ARREST_RE = /\b(arrest\w*|held|nabbed|booked|fir|detained|absconding|busted)\b/i;
const EXCLUDE_RE = /\b(court|hc|high court|supreme court|bail|verdict|sentenc\w*|convict\w*|acquit\w*|chargesheet\w*|hearing|plea|petition|judge|tribunal|opinion|editorial|minister|election|polls?|mla|mp|bjp|congress|aap|weather|rain)\b/i;

/** Headline-ish text from an article URL slug (same logic as src/http/url.ts, kept private here). */
function slugToTitle(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return '';
  }
  const segs = path.split('/').filter(Boolean);
  const idx = segs.indexOf('articleshow');
  const seg = idx > 0 ? segs[idx - 1] : segs.filter((s) => s.includes('-')).sort((a, b) => b.length - a.length)[0] ?? '';
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    /* keep raw segment */
  }
  return decoded
    .replace(/\.(html?|cms)$/i, '')
    .replace(/-\d{5,}$/, '')
    .replace(/-/g, ' ')
    .trim();
}

/** Cheap title/slug check: is this likely an incident story worth fetching? */
export function prefilter(input: { title: string; url: string }): boolean {
  const text = input.title?.trim() ? input.title : slugToTitle(input.url);
  if (!text || EXCLUDE_RE.test(text)) return false;
  return classify(text) !== 'other' || ARREST_RE.test(text);
}
