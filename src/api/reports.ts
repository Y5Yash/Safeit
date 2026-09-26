import { getResolution, isValidCell, latLngToCell } from 'h3-js';
import type { Report } from '../types.js';
import { badRequest, json } from './http.js';
import { effectiveTime, filterReports, parseCommon } from './params.js';

const INT_RE = /^\d+$/;

export function handleReports(req: Request, reports: Report[]): Response {
  const q = new URL(req.url).searchParams;
  const p = parseCommon(q);
  if ('error' in p) return badRequest(p.error);

  const limitRaw = q.get('limit');
  if (limitRaw !== null && !INT_RE.test(limitRaw)) return badRequest('limit must be a non-negative integer');
  const limit = Math.min(Math.max(limitRaw === null ? 50 : Number(limitRaw), 1), 200);
  const offsetRaw = q.get('offset');
  if (offsetRaw !== null && !INT_RE.test(offsetRaw)) return badRequest('offset must be a non-negative integer');
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);

  let rows = filterReports(reports, p);

  const h3 = q.get('h3');
  const bbox = q.get('bbox');
  if (h3 !== null) {
    if (!isValidCell(h3)) return badRequest('h3 must be a valid H3 cell index');
    const res = getResolution(h3);
    rows = rows.filter((r) => latLngToCell(r.lat, r.lng, res) === h3);
  } else if (bbox !== null) {
    const b = bbox.split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
    if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return badRequest('bbox must be minLng,minLat,maxLng,maxLat');
    const [minLng, minLat, maxLng, maxLat] = b as [number, number, number, number];
    rows = rows.filter((r) => r.lng >= minLng && r.lng <= maxLng && r.lat >= minLat && r.lat <= maxLat);
  }

  rows = [...rows].sort((a, b) => effectiveTime(b) - effectiveTime(a) || a.id.localeCompare(b.id));
  return json({ total: rows.length, reports: rows.slice(offset, offset + limit) });
}
