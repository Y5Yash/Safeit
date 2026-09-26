import { CATEGORY_IDS } from '../config/categories.js';
import { isCity } from '../config/cities.js';
import { WINDOW_DAYS } from '../config/window.js';
import type { CategoryId, City, Report } from '../types.js';

export type SourceKind = 'news' | 'police';
export interface CommonParams {
  city: City;
  from: string;
  to: string;
  start: Date;
  end: Date;
  categories: CategoryId[];
  sources: SourceKind[];
}

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_KINDS: SourceKind[] = ['news', 'police'];
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const istStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
const validDay = (ymd: string) => {
  if (!DATE_RE.test(ymd)) return false;
  const d = istStart(ymd);
  return !Number.isNaN(d.getTime()) && istDay(d) === ymd;
};

/** Parses city, from/to (IST days), categories and sources shared by the read APIs. */
export function parseCommon(q: URLSearchParams, today: Date = new Date()): CommonParams | { error: string } {
  const city = q.get('city');
  if (!isCity(city)) return { error: 'city must be one of delhi, bengaluru, goa' };
  const to = q.get('to') ?? istDay(today);
  if (!validDay(to)) return { error: 'to must be a valid YYYY-MM-DD date' };
  const from = q.get('from') ?? istDay(new Date(istStart(to).getTime() - WINDOW_DAYS * DAY_MS));
  if (!validDay(from)) return { error: 'from must be a valid YYYY-MM-DD date' };
  const start = istStart(from);
  const end = new Date(istStart(to).getTime() + DAY_MS);
  if (start >= end) return { error: 'from must be on or before to' };

  const explicit = (q.get('categories') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CategoryId => (CATEGORY_IDS as readonly string[]).includes(s));
  const categories = explicit.length ? [...new Set(explicit)] : [...CATEGORY_IDS];

  let sources = SOURCE_KINDS;
  const sp = q.get('sources');
  if (sp !== null) {
    const list = sp.split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length || list.some((s) => !(SOURCE_KINDS as string[]).includes(s))) {
      return { error: 'sources must be a comma list of news, police' };
    }
    sources = SOURCE_KINDS.filter((s) => list.includes(s));
  }
  return { city, from, to, start, end, categories, sources };
}

export const sourceKind = (r: Report): SourceKind => (r.source_type.startsWith('police_') ? 'police' : 'news');
export const effectiveTime = (r: Report): number => Date.parse(r.incident_datetime ?? r.published_datetime);

/** City, source, category and effective-time ([start, end)) filter shared by heatmap and reports. */
export function filterReports(reports: Report[], p: CommonParams): Report[] {
  const s = p.start.getTime();
  const e = p.end.getTime();
  const cats = new Set<string>(p.categories);
  return reports.filter((r) => {
    if (r.city !== p.city || !cats.has(r.category) || !p.sources.includes(sourceKind(r))) return false;
    const t = effectiveTime(r);
    return t >= s && t < e;
  });
}
