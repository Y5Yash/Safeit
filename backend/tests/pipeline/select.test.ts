import { describe, expect, it } from 'vitest';
import { eligibleByCity, mergeReports } from '../../src/pipeline/select.js';
import type { Candidate, Report } from '../../src/types.js';

const cutoff = new Date('2026-03-26T00:00:00Z');
const cand = (over: Partial<Candidate>): Candidate => ({
  url: 'https://timesofindia.indiatimes.com/city/delhi/man-stabbed-in-rohini/articleshow/1.cms',
  title: 'Man stabbed in Rohini', publishedAt: new Date('2026-09-01T00:00:00Z'), city: 'delhi', ...over,
});

let n = 0;
const rep = (over: Partial<Report>): Report => ({
  id: `r${++n}`, event_id: '', city: 'delhi', title: `unique title ${n} zebra${n}`, category: 'murder', category_raw: null,
  source_name: 'TOI', source_type: 'news', source_link: `https://x.com/${n}`, incident_datetime: null,
  incident_datetime_precision: 'unknown', published_datetime: '2026-09-12T10:00:00+05:30', location_text: null,
  police_station: null, lat: 28.6, lng: 77.2, geo_precision: 'city', description: null, ...over,
});

describe('eligibleByCity', () => {
  it('drops out-of-window, non-incident, duplicate and already-stored links; groups by city', () => {
    const found = [
      cand({}),
      cand({ url: 'http://timesofindia.indiatimes.com/city/delhi/man-stabbed-in-rohini/articleshow/1.cms?utm=x' }),
      cand({ url: 'https://timesofindia.indiatimes.com/city/delhi/old/articleshow/2.cms', publishedAt: new Date('2026-01-01T00:00:00Z') }),
      cand({ url: 'https://timesofindia.indiatimes.com/city/delhi/rain/articleshow/3.cms', title: 'Heavy rain lashes city' }),
      cand({ url: 'https://timesofindia.indiatimes.com/city/delhi/stored/articleshow/4.cms', title: 'Chain snatched in Saket' }),
      cand({ url: 'https://timesofindia.indiatimes.com/city/goa/theft/articleshow/5.cms', title: 'Theft at Calangute shop', city: 'goa' }),
      cand({ url: 'https://timesofindia.indiatimes.com/city/goa/nodate/articleshow/6.cms', publishedAt: null, city: 'goa' }),
    ];
    const existing = new Set(['https://timesofindia.indiatimes.com/city/delhi/stored/articleshow/4.cms']);
    const { byCity, stats } = eligibleByCity(found, { cutoff, existing });
    expect(byCity.get('delhi')!.map((c) => c.url)).toEqual(['https://timesofindia.indiatimes.com/city/delhi/man-stabbed-in-rohini/articleshow/1.cms']);
    expect(byCity.get('goa')!).toHaveLength(1);
    expect(stats).toEqual({ discovered: 7, outOfWindow: 1, undated: 1, prefiltered: 1, duplicates: 1, existing: 1, eligible: 2 });
  });

  it('a re-run over the same discovery output selects nothing new once links are stored', () => {
    const found = [cand({})];
    const first = eligibleByCity(found, { cutoff, existing: new Set() });
    const stored = new Set([...first.byCity.values()].flat().map((c) => c.url));
    expect(eligibleByCity(found, { cutoff, existing: stored }).stats.eligible).toBe(0);
  });
});

describe('mergeReports', () => {
  it('upserts by source_link (no duplicates), assigns events and sorts newest first', () => {
    const a = rep({ source_link: 'https://l/1', published_datetime: '2026-09-10T10:00:00+05:30' });
    const b = rep({ source_link: 'https://l/2', published_datetime: '2026-09-12T10:00:00+05:30' });
    const a2 = { ...a, title: 'updated title' };
    const out = mergeReports([a, b], [a2]);
    expect(out.map((r) => r.source_link)).toEqual(['https://l/2', 'https://l/1']);
    expect(out[1].title).toBe('updated title');
    expect(out.every((r) => r.event_id === r.id)).toBe(true);
    expect(mergeReports(out, out)).toHaveLength(2);
  });

  it('groups the same incident reported twice under the earliest id', () => {
    const x = rep({ id: 'late', title: 'Man stabbed to death in Krishna Nagar', published_datetime: '2026-09-12T12:00:00+05:30' });
    const y = rep({ id: 'early', title: 'Two held for stabbing man to death in Krishna Nagar', published_datetime: '2026-09-12T08:00:00+05:30' });
    const out = mergeReports([], [x, y]);
    expect(out.map((r) => r.event_id)).toEqual(['early', 'early']);
  });
});
