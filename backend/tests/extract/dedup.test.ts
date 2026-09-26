import { describe, expect, it } from 'vitest';
import { assignEvents, jaccard, titleTokens } from '../../src/extract/dedup.js';
import type { Report } from '../../src/types.js';

let n = 0;
const rep = (over: Partial<Report>): Report => ({
  id: `r${++n}`,
  event_id: '',
  city: 'delhi',
  title: '',
  category: 'murder',
  category_raw: null,
  source_name: 'TOI',
  source_type: 'news',
  source_link: `https://x.com/${n}`,
  incident_datetime: null,
  incident_datetime_precision: 'unknown',
  published_datetime: '2026-09-12T10:00:00.000Z',
  location_text: null,
  police_station: null,
  lat: 28.6,
  lng: 77.2,
  geo_precision: 'city',
  description: null,
  ...over,
});

describe('titleTokens / jaccard', () => {
  it('stems and drops stopwords/generic words', () => {
    expect([...titleTokens('Two arrested for stabbing man to death in Krishna Nagar')].sort())
      .toEqual(['death', 'krishna', 'nagar', 'stabb', 'two']);
  });
  it('scores overlap', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('assignEvents', () => {
  it('matches the same incident across outlets; event_id is the earliest report', () => {
    const a = rep({ id: 'b', title: 'Two arrested for stabbing man to death in Krishna Nagar', published_datetime: '2026-09-12T12:00:00Z' });
    const b = rep({ id: 'a', title: 'Man stabbed to death in Krishna Nagar, two held', published_datetime: '2026-09-12T08:00:00Z' });
    const out = assignEvents([a, b]);
    expect(out.map((r) => r.event_id)).toEqual(['a', 'a']);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('breaks ties on published time by smallest id', () => {
    const out = assignEvents([
      rep({ id: 'z', title: 'Man stabbed to death in Krishna Nagar' }),
      rep({ id: 'm', title: 'Man stabbed to death in Krishna Nagar' }),
    ]);
    expect(out.map((r) => r.event_id)).toEqual(['m', 'm']);
  });

  it('does not merge different incidents or distant dates', () => {
    const out = assignEvents([
      rep({ id: 'x1', title: 'Man stabbed to death in Krishna Nagar' }),
      rep({ id: 'x2', title: 'Woman duped of Rs 5 lakh in digital arrest scam' }),
      rep({ id: 'x3', title: 'Man stabbed to death in Krishna Nagar', published_datetime: '2026-09-20T10:00:00Z' }),
    ]);
    expect(out.map((r) => r.event_id)).toEqual(['x1', 'x2', 'x3']);
  });

  it('never merges different cities', () => {
    const out = assignEvents([
      rep({ id: 'd', city: 'delhi', title: 'Man stabbed to death in Krishna Nagar', police_station: 'Krishna Nagar',
        incident_datetime: '2026-09-11T18:00:00Z' }),
      rep({ id: 'g', city: 'goa', title: 'Man stabbed to death in Krishna Nagar', police_station: 'Krishna Nagar',
        incident_datetime: '2026-09-11T18:00:00Z' }),
    ]);
    expect(out.map((r) => r.event_id)).toEqual(['d', 'g']);
  });

  it('groups transitively', () => {
    // a~b by title, b~c by station+category+date, a and c share neither
    const out = assignEvents([
      rep({ id: 'c', title: 'Youth hacked in east Delhi lane', police_station: 'Shahdara', category: 'murder',
        incident_datetime: '2026-09-10T20:00:00Z', published_datetime: '2026-09-25T10:00:00Z' }),
      rep({ id: 'a', title: 'Man stabbed to death in Krishna Nagar', published_datetime: '2026-09-11T10:00:00Z' }),
      rep({ id: 'b', title: 'Man stabbed to death in Krishna Nagar, two held', police_station: 'Shahdara',
        category: 'murder', incident_datetime: '2026-09-10T19:00:00Z', published_datetime: '2026-09-12T10:00:00Z' }),
    ]);
    expect(out.map((r) => r.event_id)).toEqual(['a', 'a', 'a']);
  });

  it('rule (b): same station + category + IST incident day, regardless of title/publish gap', () => {
    // 2026-09-10T19:00Z = 11 Sep 00:30 IST; 2026-09-11T10:00Z = 11 Sep 15:30 IST
    const base = { police_station: 'Rohini', category: 'robbery' as const };
    const out = assignEvents([
      rep({ id: 'p', ...base, title: 'Trader robbed at gunpoint', incident_datetime: '2026-09-10T19:00:00Z',
        published_datetime: '2026-09-12T10:00:00Z' }),
      rep({ id: 'q', ...base, title: 'Cops crack jewellery loot case', incident_datetime: '2026-09-11T10:00:00Z',
        published_datetime: '2026-09-20T10:00:00Z' }),
      // same UTC date as p but a different IST day (10 Sep 23:00 IST)
      rep({ id: 'r', ...base, title: 'Shopkeeper looted in market', incident_datetime: '2026-09-10T17:30:00Z',
        published_datetime: '2026-09-25T10:00:00Z' }),
      // different category
      rep({ id: 's', police_station: 'Rohini', category: 'assault', title: 'Guard beaten outside mall',
        incident_datetime: '2026-09-11T10:00:00Z', published_datetime: '2026-09-28T10:00:00Z' }),
      // null station never matches via rule (b)
      rep({ id: 't', police_station: null, category: 'robbery', title: 'Gang loots courier',
        incident_datetime: '2026-09-11T10:00:00Z', published_datetime: '2026-09-29T10:00:00Z' }),
    ]);
    expect(out.map((r) => r.event_id)).toEqual(['p', 'p', 'r', 's', 't']);
  });

  it('does not mutate inputs and is idempotent', () => {
    const input = [
      rep({ id: 'k2', title: 'Man stabbed to death in Krishna Nagar', event_id: 'old' }),
      rep({ id: 'k1', title: 'Two arrested for stabbing man to death in Krishna Nagar', published_datetime: '2026-09-11T10:00:00Z' }),
      rep({ id: 'k3', title: 'Techie loses Rs 1.2 crore to digital arrest scam' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    const once = assignEvents(input);
    expect(input).toEqual(snapshot);
    expect(once).not.toBe(input);
    expect(once[0]).not.toBe(input[0]);
    const twice = assignEvents(once);
    expect(twice.map((r) => r.event_id)).toEqual(once.map((r) => r.event_id));
    expect(once.map((r) => r.event_id)).toEqual(['k1', 'k1', 'k3']);
  });

  it('handles an empty list', () => {
    expect(assignEvents([])).toEqual([]);
  });
});
