import { createHash } from 'node:crypto';
import { classify, type CategoryId } from '../config/categories.js';
import { inCity } from '../config/cities.js';
import { windowStart } from '../config/window.js';
import { CITIES, type City, type Report } from '../types.js';
import { cleanDescription, cleanText } from './enrich.js';
import { toIstIso } from './time.js';

/**
 * One row of a SafeMap review dataset CSV (data/reviews/*.csv): a negative Google Maps review
 * that an LLM classified as a safety incident. Only the columns used here are listed.
 */
export interface ReviewRow {
  title?: string;
  category?: string;
  source_link?: string;
  date_time?: string;
  location?: string;
  description?: string;
  place_name?: string;
  zone?: string;
  subcategory?: string;
  latitude?: string;
  longitude?: string;
  record_type?: string;
  [k: string]: string | undefined;
}

export type ReviewMapResult = { ok: true; report: Report } | { ok: false; reason: string };

export const REVIEW_SOURCE_NAME = 'Google Maps reviews';

const sha12 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** SafeMap subcategory → Safe-it category (most specific first). */
const SUBCATEGORY_MAP: Record<string, CategoryId> = {
  UPI_FRAUD: 'cyber_fraud',
  ONLINE_FRAUD: 'cyber_fraud',
  CARD_FRAUD: 'cyber_fraud',
  SEXUAL_HARASSMENT: 'sexual_crime',
  HARASSMENT: 'sexual_crime',
  ROAD_ACCIDENT: 'road_accident',
  ROBBERY: 'robbery',
  CHAIN_SNATCHING: 'snatching',
  PHONE_SNATCHING: 'snatching',
  THEFT: 'burglary_theft',
  PICKPOCKETING: 'burglary_theft',
  BURGLARY: 'burglary_theft',
  ASSAULT: 'assault',
  KIDNAPPING: 'kidnapping',
  STAMPEDE: 'public_safety',
  ELECTROCUTION: 'public_safety',
  FIRE: 'public_safety',
};

/** SafeMap category → Safe-it category, used when the subcategory is not decisive. */
const CATEGORY_MAP: Record<string, CategoryId | null> = {
  Scam: 'fraud',
  Fraud: 'fraud',
  Harassment: 'sexual_crime',
  Accident: 'road_accident',
  'Natural disaster': 'public_safety',
  'Infrastructure hazard': 'public_safety',
  'Unsafe area': 'public_safety',
  Crime: null, // decided by the Safe-it classifier on the title/description
};

export function reviewCategory(row: ReviewRow): CategoryId {
  const sub = (row.subcategory ?? '').trim().toUpperCase();
  if (SUBCATEGORY_MAP[sub]) return SUBCATEGORY_MAP[sub];
  const mapped = CATEGORY_MAP[(row.category ?? '').trim()];
  if (mapped) return mapped;
  return classify(`${row.title ?? ''} ${row.description ?? ''}`);
}

function num(v: string | undefined): number | null {
  const n = v !== undefined && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The Safe-it city whose area contains the point, or null. */
export function cityFor(lat: number, lng: number): City | null {
  return CITIES.find((c) => inCity(c, lat, lng)) ?? null;
}

/** Pure mapping of one review CSV row to a Report. Rows outside the 6-month window or city areas are skipped. */
export function reviewRowToReport(row: ReviewRow, now: number = Date.now()): ReviewMapResult {
  if ((row.record_type ?? 'incident') !== 'incident') return { ok: false, reason: 'not an incident row' };
  const source_link = row.source_link?.trim();
  if (!source_link) return { ok: false, reason: 'no source_link' };
  try { new URL(source_link); } catch { return { ok: false, reason: 'bad source_link' }; }

  const title = cleanText(row.title);
  if (!title) return { ok: false, reason: 'no title' };

  const published = row.date_time ? new Date(row.date_time) : null;
  if (!published || Number.isNaN(published.getTime())) return { ok: false, reason: 'no date_time' };
  if (published < windowStart(now)) return { ok: false, reason: 'older than the 6-month window' };

  const lat = num(row.latitude);
  const lng = num(row.longitude);
  if (lat === null || lng === null) return { ok: false, reason: 'no coordinates' };
  const city = cityFor(lat, lng);
  if (!city) return { ok: false, reason: 'out of area' };

  const category = reviewCategory(row);
  const place = cleanText(row.place_name);
  const zone = cleanText(row.zone);
  const id = sha12(source_link);
  return {
    ok: true,
    report: {
      id,
      event_id: id,
      city,
      title,
      category,
      category_raw: [row.category, row.subcategory].map((s) => s?.trim()).filter(Boolean).join(' / ').toLowerCase() || null,
      source_name: REVIEW_SOURCE_NAME,
      source_type: 'review',
      source_link,
      // A review's date is when it was posted, not when the incident happened.
      incident_datetime: null,
      incident_datetime_precision: 'unknown',
      published_datetime: toIstIso(published),
      location_text: [place, zone && zone !== place ? zone : null].filter(Boolean).join(', ') || cleanText(row.location),
      police_station: null,
      lat,
      lng,
      // Coordinates are the reviewed place itself (Google Maps pin).
      geo_precision: 'address',
      description: cleanDescription(row.description),
    },
  };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, embedded newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
