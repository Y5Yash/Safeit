import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { classify, classifyRaw } from '../src/config/categories.js';
import { assignEvents } from '../src/extract/dedup.js';
import { scrubPii } from '../src/extract/pii.js';
import { GENERIC_POLICE_RE } from '../src/geo/matcher.js';
import { createResolver } from '../src/pipeline/deps.js';
import type { Report } from '../src/types.js';

// Re-derives fields of stored reports without re-scraping — run after changing
// src/config/categories.ts, the PII scrubber or the gazetteer.
// Usage: npm run reprocess [-- --file data/reports.json]
const { values } = parseArgs({ options: { file: { type: 'string', default: 'data/reports.json' } } });
const file = values.file!;
const rows = JSON.parse(readFileSync(file, 'utf8')) as Report[];
const { resolve, flush } = createResolver('data/geocode-cache.json');

let relocated = 0;
const out: Report[] = [];
for (const r of rows) {
  const title = scrubPii(r.title);
  const description = r.description ? scrubPii(r.description) || null : null;
  const next: Report = { ...r, title, description, location_text: r.location_text ? scrubPii(r.location_text) : null };
  if (r.source_type === 'news') {
    const text = `${title} ${description ?? ''}`;
    next.category = classify(text);
    next.category_raw = classifyRaw(text);
  }
  if (r.police_station && GENERIC_POLICE_RE.test(r.police_station.toLowerCase())) {
    const loc = await resolve({ city: r.city, title, keywords: [], text: description ?? '' });
    Object.assign(next, loc.in_area
      ? { location_text: loc.location_text, police_station: loc.police_station, lat: loc.lat, lng: loc.lng, geo_precision: loc.geo_precision }
      : { location_text: null, police_station: null, geo_precision: 'city' });
    relocated++;
  }
  out.push(next);
}
await flush();
writeFileSync(file, JSON.stringify(assignEvents(out), null, 2) + '\n');
console.log(`reprocessed ${out.length} rows, relocated ${relocated}`);
