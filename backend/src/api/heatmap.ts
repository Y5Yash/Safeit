import { cellToLatLng, latLngToCell } from 'h3-js';
import type { GeoPrecision, Report } from '../types.js';
import { badRequest, json } from './http.js';
import { filterReports, parseCommon } from './params.js';

const PRECISION_RANK: Record<GeoPrecision, number> = { address: 0, police_station: 1, locality: 2, city: 3 };
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Negative when a is the better representative of an event than b. */
function compareRep(a: Report, b: Report): number {
  const pa = a.source_type.startsWith('police_') ? 0 : 1;
  const pb = b.source_type.startsWith('police_') ? 0 : 1;
  if (pa !== pb) return pa - pb;
  const g = PRECISION_RANK[a.geo_precision] - PRECISION_RANK[b.geo_precision];
  if (g !== 0) return g;
  return Date.parse(a.published_datetime) - Date.parse(b.published_datetime);
}

export function representatives(reports: Report[]): Report[] {
  const best = new Map<string, Report>();
  for (const r of reports) {
    const cur = best.get(r.event_id);
    if (!cur || compareRep(r, cur) < 0) best.set(r.event_id, r);
  }
  return [...best.values()];
}

interface Cell { h3: string; lat: number; lng: number; count: number; categories: Record<string, number> }

export function handleHeatmap(req: Request, reports: Report[]): Response {
  const q = new URL(req.url).searchParams;
  const p = parseCommon(q);
  if ('error' in p) return badRequest(p.error);
  const res = q.has('res') ? Number(q.get('res')) : 8;
  if (!Number.isInteger(res) || res < 5 || res > 10) return badRequest('res must be an integer between 5 and 10');

  // City-level geocodes are dropped before choosing representatives so they are never plotted.
  const points = representatives(filterReports(reports, p).filter((r) => r.geo_precision !== 'city'));
  const cells = new Map<string, Cell>();
  for (const r of points) {
    const h3 = latLngToCell(r.lat, r.lng, res);
    let c = cells.get(h3);
    if (!c) {
      const [lat, lng] = cellToLatLng(h3);
      c = { h3, lat: r6(lat), lng: r6(lng), count: 0, categories: {} };
      cells.set(h3, c);
    }
    c.count++;
    c.categories[r.category] = (c.categories[r.category] ?? 0) + 1;
  }
  const sorted = [...cells.values()].sort((a, b) => b.count - a.count || a.h3.localeCompare(b.h3));
  return json({
    city: p.city, from: p.from, to: p.to, res, total: points.length,
    max_count: sorted[0]?.count ?? 0, cells: sorted,
  });
}
