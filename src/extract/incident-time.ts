import type { IncidentTime } from '../types.js';

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const ORD = '(?:st|nd|rd|th)?';
const EXPLICIT_RE = new RegExp(`\\bon\\s+(?:(\\d{1,2})${ORD}\\s+${MON}|${MON}\\s+(\\d{1,2})${ORD})\\b`, 'i');
/** "(intervening) night of 20/21", "20-21", "20th/21st", optional "September [2026]" or ".09[.2026]". */
const NIGHT_RE = new RegExp(
  `\\bnight\\s+of\\s+(\\d{1,2})${ORD}\\s*[/&-]\\s*(\\d{1,2})(?!\\d)${ORD}` +
    `(?:[./-](\\d{1,2})(?:[./-](\\d{4}|\\d{2}))?(?!\\d)|\\s+${MON}(?:,?\\s+(\\d{4}))?)?`,
  'i',
);
const WEEKDAY_RE = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const YESTERDAY_RE = /\b(yesterday|last night|previous night|intervening night)\b/i;
const TODAY_RE = /\b(today|this morning|this afternoon|earlier in the day|tonight)\b/i;
const TIME_RE = /\b(\d{1,2})(?:[.:](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.;)]|$)/i;

interface Ymd { y: number; m: number; d: number }

export function istDate(y: number, m0: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m0, d, h, min) - IST_MS);
}

function istParts(date: Date): Ymd & { dow: number } {
  const t = new Date(date.getTime() + IST_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay() };
}

function addDays(p: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(p.y, p.m, p.d) + n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

function validDay(y: number, m: number, d: number): boolean {
  return m >= 0 && m <= 11 && d >= 1 && new Date(Date.UTC(y, m, d)).getUTCDate() === d;
}

function findNightRange(lead: string, pub: Ymd): Ymd | null {
  const r = lead.match(NIGHT_RE);
  if (!r) return null;
  const d1 = Number(r[1]);
  const d2 = Number(r[2]);
  if (d1 < 1 || d1 > 31 || !(d2 === d1 + 1 || d2 === 1)) return null;
  const pubUtc = Date.UTC(pub.y, pub.m, pub.d);
  const yearStr = r[4] ?? r[6];
  let m: number;
  let y: number;
  if (r[3] || r[5]) {
    m = r[3] ? Number(r[3]) - 1 : MONTHS.indexOf(r[5].slice(0, 3).toLowerCase());
    if (yearStr) {
      y = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    } else {
      y = Date.UTC(pub.y, m, d1) > pubUtc ? pub.y - 1 : pub.y;
    }
  } else {
    y = pub.y;
    m = pub.m;
    if (Date.UTC(y, m, d1) > pubUtc) {
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
  }
  return validDay(y, m, d1) ? { y, m, d: d1 } : null;
}

function findDay(lead: string, pub: Ymd & { dow: number }): Ymd | null {
  const ex = lead.match(EXPLICIT_RE);
  if (ex) {
    const d = Number(ex[1] ?? ex[4]);
    const m = MONTHS.indexOf((ex[2] ?? ex[3]).slice(0, 3).toLowerCase());
    if (d >= 1 && d <= 31 && m >= 0) {
      const y = Date.UTC(pub.y, m, d) > Date.UTC(pub.y, pub.m, pub.d) ? pub.y - 1 : pub.y;
      return { y, m, d };
    }
  }
  const wd = lead.match(WEEKDAY_RE);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
    return addDays(pub, -((pub.dow - target + 7) % 7));
  }
  if (YESTERDAY_RE.test(lead)) return addDays(pub, -1);
  if (TODAY_RE.test(lead)) return { y: pub.y, m: pub.m, d: pub.d };
  return null;
}

function findTime(lead: string): { h: number; min: number } | null {
  const t = lead.match(TIME_RE);
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  const pm = t[3].toLowerCase().startsWith('p');
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return { h, min };
}

export function extractIncidentTime(text: string, publishedAt: Date): IncidentTime {
  const lead = text.slice(0, 1500);
  const pub = istParts(publishedAt);
  const night = findNightRange(lead, pub);
  if (night) return { incidentAt: istDate(night.y, night.m, night.d), precision: 'date_range' };
  const day = findDay(lead, pub);
  if (!day) return { incidentAt: null, precision: 'unknown' };
  const time = findTime(lead);
  if (time) return { incidentAt: istDate(day.y, day.m, day.d, time.h, time.min), precision: 'exact' };
  return { incidentAt: istDate(day.y, day.m, day.d), precision: 'date' };
}
