import type { Report } from '../../src/types.js';

let n = 0;
export function rep(over: Partial<Report> = {}): Report {
  n++;
  return {
    id: `r${n}`, event_id: `e${n}`, city: 'delhi', title: `t${n}`, category: 'robbery', category_raw: null,
    source_name: 'TOI', source_type: 'news', source_link: `https://x/${n}`,
    incident_datetime: null, incident_datetime_precision: 'unknown',
    published_datetime: '2026-09-20T10:00:00+05:30', location_text: 'X', police_station: null,
    lat: 28.6015, lng: 77.2015, geo_precision: 'locality', description: null, ...over,
  };
}
