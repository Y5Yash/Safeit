import { createHash } from 'node:crypto';
import { classify, classifyRaw } from '../config/categories.js';
import { extractIncidentTime } from '../extract/incident-time.js';
import { scrubPii } from '../extract/pii.js';
import { canonicalUrl } from '../http/url.js';
import type { Article, LocationInput, Report, ResolvedLocation } from '../types.js';
import { toIstIso } from './time.js';

export interface EnrichDeps {
  resolve: (i: LocationInput) => Promise<ResolvedLocation>;
}

export const MAX_DESCRIPTION = 300;

/** First 12 hex chars of sha1(canonical link). */
export function reportId(link: string): string {
  return createHash('sha1').update(canonicalUrl(link)).digest('hex').slice(0, 12);
}

/** Scrubs PII and cuts to ≤ max chars (at a word boundary, with an ellipsis). Empty → null. */
export function cleanDescription(s: string | null | undefined, max = MAX_DESCRIPTION): string | null {
  const t = scrubPii(s ?? '').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** Site-name suffixes that some pages append to the headline (e.g. HT's " | Latest News Delhi"). */
const TITLE_SUFFIX_RE = /\s+[|\u2013\u2014-]\s+(latest news\b.*|hindustan times|times of india|the times of india|deccan herald|goemkarponn\b.*)$/i;

export function cleanTitle(s: string): string {
  let t = scrubPii(s).trim();
  for (let prev = ''; prev !== t; ) { prev = t; t = t.replace(TITLE_SUFFIX_RE, '').trim(); }
  return t;
}

export function cleanText(s: string | null | undefined): string | null {
  const t = s ? scrubPii(s).trim() : '';
  return t || null;
}

/** Article → Report, or null when the resolved location is outside the city area. */
export async function enrichArticle(a: Article, deps: EnrichDeps): Promise<Report | null> {
  const where = await deps.resolve({ city: a.city, title: a.title, keywords: a.keywords, text: a.text });
  if (!where.in_area) return null;
  const link = canonicalUrl(a.url);
  const id = reportId(link);
  const catText = `${a.title} ${a.description ?? ''}`;
  const inc = extractIncidentTime(a.text, a.publishedAt);
  return {
    id,
    event_id: id,
    city: a.city,
    title: cleanTitle(a.title),
    category: classify(catText),
    category_raw: classifyRaw(catText),
    source_name: a.sourceName,
    source_type: 'news',
    source_link: link,
    incident_datetime: inc.incidentAt ? toIstIso(inc.incidentAt) : null,
    incident_datetime_precision: inc.incidentAt ? inc.precision : 'unknown',
    published_datetime: toIstIso(a.publishedAt),
    location_text: cleanText(where.location_text),
    police_station: where.police_station,
    lat: where.lat,
    lng: where.lng,
    geo_precision: where.geo_precision,
    description: cleanDescription(a.description),
  };
}
