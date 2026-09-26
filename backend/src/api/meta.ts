import { CATEGORIES, GROUPS } from '../config/categories.js';
import { CITY_CONFIG } from '../config/cities.js';
import type { City, Report, SourceType } from '../types.js';
import { json } from './http.js';
import { effectiveTime } from './params.js';

interface SourceCount { city: City; source_name: string; source_type: SourceType; count: number }

export function handleMeta(_req: Request, reports: Report[]): Response {
  const counts = new Map<string, SourceCount>();
  let min = Infinity;
  let max = -Infinity;
  for (const r of reports) {
    const key = `${r.city}\u0000${r.source_name}\u0000${r.source_type}`;
    const c = counts.get(key) ?? { city: r.city, source_name: r.source_name, source_type: r.source_type, count: 0 };
    c.count++;
    counts.set(key, c);
    const t = effectiveTime(r);
    if (Number.isFinite(t)) {
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }
  const sources = [...counts.values()].sort(
    (a, b) => a.city.localeCompare(b.city) || a.source_name.localeCompare(b.source_name) || a.source_type.localeCompare(b.source_type),
  );
  return json({
    cities: Object.entries(CITY_CONFIG).map(([id, c]) => ({ id, name: c.displayName, center: c.center, bbox: c.bbox })),
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
    groups: GROUPS.map(({ id, label, color, disabled }) => ({ id, label, color, ...(disabled ? { disabled } : {}) })),
    sources,
    date_range: Number.isFinite(min) ? { min: new Date(min).toISOString(), max: new Date(max).toISOString() } : null,
  });
}
