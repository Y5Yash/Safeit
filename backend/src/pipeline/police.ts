import { createHash } from 'node:crypto';
import { CATEGORY_IDS, classify, classifyRaw, type CategoryId } from '../config/categories.js';
import { inCity, isCity } from '../config/cities.js';
import { windowStart } from '../config/window.js';
import { SOURCE_TYPES, type GeoPrecision, type IncidentPrecision, type LocationInput, type Report, type ResolvedLocation, type SourceType } from '../types.js';
import { cleanDescription, cleanText } from './enrich.js';
import { toIstIso } from './time.js';

/** One line of the police session's incidents.jsonl (merge_plan.md §2). Extra fields are ignored. */
export interface PoliceRow {
  event_id?: string | null;
  city?: string | null;
  title?: string | null;
  category?: string | null;
  category_raw?: string | null;
  legal_sections?: string[] | null;
  source_link?: string | null;
  mentions?: { source_name?: string | null; source_type?: string | null; url?: string | null; published_at?: string | null }[] | null;
  source_type?: string | null;
  source_name?: string | null;
  incident_datetime?: string | null;
  incident_datetime_precision?: string | null;
  published_datetime?: string | null;
  fir_datetime?: string | null;
  location_text?: string | null;
  police_station?: string | null;
  district?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  geo_precision?: string | null;
  description?: string | null;
  fir_no?: string | null;
  is_crime_incident?: boolean | null;
  [k: string]: unknown;
}

export type PoliceMapResult =
  | { ok: true; report: Report; needsGeo: boolean }
  | { ok: false; reason: string };

const INCIDENT_PRECISION: Record<string, IncidentPrecision> = {
  exact: 'exact', date: 'date', date_range: 'date_range', approx: 'date', unknown: 'unknown',
};
const GEO_PRECISION: Record<string, GeoPrecision> = {
  address: 'address', locality: 'locality', police_station: 'police_station', district: 'city', city: 'city',
};

const sha12 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // All police dates are IST: a bare date is IST midnight, a datetime without an offset is IST wall time.
  const t = s.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+05:30`
    : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t) ? `${t.replace(' ', 'T')}+05:30` : t;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * The stored link. Police pages (a press-release list, an FIR-list PDF) often carry many incidents,
 * so police rows with a fir_no / event_id get it as a URL fragment to keep one row per incident.
 * Query strings are kept (police sites often identify documents by query parameters).
 */
export function policeLink(url: string, sourceType: SourceType, row: PoliceRow): string {
  const u = new URL(url);
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const key = sourceType === 'news' ? null : (row.fir_no ?? row.event_id ?? null);
  return key ? `${u.toString()}#${encodeURIComponent(String(key).trim())}` : u.toString();
}

/** Pure mapping of one police-session row to a Report (lat/lng may still need geocoding). */
export function policeRowToReport(row: PoliceRow, now: number = Date.now()): PoliceMapResult {
  if (row.is_crime_incident === false) return { ok: false, reason: 'not a crime incident' };
  if (!isCity(row.city)) return { ok: false, reason: `unknown city ${row.city}` };
  const city = row.city;
  const mentions = Array.isArray(row.mentions) ? row.mentions : [];
  const first = mentions.find((m) => m?.url) ?? mentions[0];

  const rawType = row.source_type ?? first?.source_type ?? 'police_press_release';
  if (!(SOURCE_TYPES as readonly string[]).includes(rawType)) return { ok: false, reason: `unknown source_type ${rawType}` };
  const source_type = rawType as SourceType;

  const rawLink = row.source_link ?? first?.url ?? null;
  if (!rawLink) return { ok: false, reason: 'no source_link' };
  let source_link: string;
  try { source_link = policeLink(rawLink, source_type, row); } catch { return { ok: false, reason: `bad source_link ${rawLink}` }; }

  const title = cleanText(row.title);
  if (!title) return { ok: false, reason: 'no title' };

  const published = parseDate(row.published_datetime)
    ?? mentions.map((m) => parseDate(m?.published_at)).filter((d): d is Date => d !== null).sort((a, b) => +a - +b)[0]
    ?? parseDate(row.fir_datetime);
  if (!published) return { ok: false, reason: 'no published_datetime' };
  if (published < windowStart(now)) return { ok: false, reason: 'older than the 6-month window' };

  const catText = `${row.category ?? ''} ${row.category_raw ?? ''} ${row.title ?? ''}`;
  const category: CategoryId = row.category && (CATEGORY_IDS as string[]).includes(row.category)
    ? (row.category as CategoryId) : classify(catText);
  const category_raw = cleanText(row.category_raw) ?? classifyRaw(catText);

  const incident = parseDate(row.incident_datetime);
  const lat = num(row.lat);
  const lng = num(row.lng);
  const hasPoint = lat !== null && lng !== null;
  if (hasPoint && !inCity(city, lat, lng)) return { ok: false, reason: 'out of area' };

  const id = sha12(source_link);
  return {
    ok: true,
    needsGeo: !hasPoint,
    report: {
      id,
      event_id: id,
      city,
      title,
      category,
      category_raw,
      source_name: row.source_name ?? first?.source_name ?? 'Police',
      source_type,
      source_link,
      incident_datetime: incident ? toIstIso(incident) : null,
      incident_datetime_precision: incident ? (INCIDENT_PRECISION[row.incident_datetime_precision ?? ''] ?? 'unknown') : 'unknown',
      published_datetime: toIstIso(published),
      location_text: cleanText(row.location_text),
      police_station: cleanText(row.police_station),
      lat: hasPoint ? lat : 0,
      lng: hasPoint ? lng : 0,
      geo_precision: hasPoint ? (GEO_PRECISION[row.geo_precision ?? ''] ?? 'locality') : 'city',
      description: cleanDescription(row.description),
    },
  };
}

/** The resolver input for a police report without coordinates. */
export function policeLocationInput(r: Report): LocationInput {
  const ps = r.police_station ? `${r.police_station} police station` : null;
  return {
    city: r.city,
    title: r.title,
    keywords: [r.location_text, r.police_station].filter((s): s is string => !!s),
    text: [ps, r.description].filter(Boolean).join('. '),
    location_text: r.location_text ?? ps,
  };
}

/** Geocodes a mapped report that had no lat/lng. Null when the place resolves out of area. */
export async function geocodePoliceReport(
  r: Report,
  resolve: (i: LocationInput) => Promise<ResolvedLocation>,
): Promise<Report | null> {
  const where = await resolve(policeLocationInput(r));
  if (!where.in_area) return null;
  return {
    ...r,
    lat: where.lat,
    lng: where.lng,
    geo_precision: where.geo_precision,
    location_text: r.location_text ?? cleanText(where.location_text),
    police_station: r.police_station ?? where.police_station,
  };
}
