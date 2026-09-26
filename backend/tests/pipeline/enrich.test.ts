import { describe, expect, it } from 'vitest';
import { cleanDescription, cleanTitle, enrichArticle, reportId, type EnrichDeps } from '../../src/pipeline/enrich.js';
import type { Article, LocationInput } from '../../src/types.js';

const article: Article = {
  url: 'http://timesofindia.indiatimes.com/city/delhi/man-stabbed/articleshow/1.cms?from=rss#x',
  title: 'Man, 32-year-old, stabbed in Krishna Nagar',
  publishedAt: new Date('2026-09-12T04:30:00Z'),
  description: 'A man s/o Suresh Kumar, r/o Gali 4, was stabbed near the market on Tuesday night.',
  text: 'A man was stabbed on Tuesday night near Krishna Nagar market. Police registered a case.',
  keywords: ['Krishna Nagar'],
  city: 'delhi',
  sourceName: 'Times of India',
};

const seen: LocationInput[] = [];
const inArea: EnrichDeps = {
  resolve: async (i) => {
    seen.push(i);
    return { location_text: 'Krishna Nagar', police_station: 'Krishna Nagar', lat: 28.66, lng: 77.28, geo_precision: 'police_station', in_area: true };
  },
};
const outOfArea: EnrichDeps = {
  resolve: async () => ({ location_text: 'Nelamangala', police_station: null, lat: 13.1, lng: 77.39, geo_precision: 'locality', in_area: false }),
};

describe('enrichArticle', () => {
  it('builds a scrubbed Report from an in-area article', async () => {
    const r = (await enrichArticle(article, inArea))!;
    const link = 'https://timesofindia.indiatimes.com/city/delhi/man-stabbed/articleshow/1.cms';
    expect(r.source_link).toBe(link);
    expect(r.id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.id).toBe(reportId(link));
    expect(r.event_id).toBe(r.id);
    expect(r.source_type).toBe('news');
    expect(r.source_name).toBe('Times of India');
    expect(r.city).toBe('delhi');
    expect(r.category).toBe('assault');
    expect(r.category_raw).toBe('stabbed');
    expect(r.published_datetime).toBe('2026-09-12T10:00:00+05:30');
    expect(r.incident_datetime_precision).not.toBe('exact');
    expect(r.police_station).toBe('Krishna Nagar');
    expect(r.geo_precision).toBe('police_station');
    expect([r.lat, r.lng]).toEqual([28.66, 77.28]);
    expect(r.title).not.toMatch(/year-old/);
    expect(r.description).not.toMatch(/s\/o|r\/o|Suresh Kumar/);
    expect(seen.at(-1)).toMatchObject({ city: 'delhi', title: article.title, keywords: ['Krishna Nagar'] });
    expect(Object.keys(r).sort()).toEqual([
      'category', 'category_raw', 'city', 'description', 'event_id', 'geo_precision', 'id', 'incident_datetime',
      'incident_datetime_precision', 'lat', 'lng', 'location_text', 'police_station', 'published_datetime',
      'source_link', 'source_name', 'source_type', 'title',
    ]);
  });

  it('returns null when the location is out of area', async () => {
    expect(await enrichArticle({ ...article, city: 'bengaluru' }, outOfArea)).toBeNull();
  });

  it('stores a null description when there is none', async () => {
    const r = (await enrichArticle({ ...article, description: null }, inArea))!;
    expect(r.description).toBeNull();
  });
});

describe('cleanDescription', () => {
  it('keeps descriptions to at most 300 chars', () => {
    const long = 'word '.repeat(200);
    const d = cleanDescription(long)!;
    expect(d.length).toBeLessThanOrEqual(300);
    expect(d.endsWith('…')).toBe(true);
    expect(cleanDescription('  ')).toBeNull();
    expect(cleanDescription('short one')).toBe('short one');
  });
});

describe('cleanTitle', () => {
  it('drops site-name suffixes but keeps normal dashes', () => {
    expect(cleanTitle('Teen stabbed to death in Delhi | Latest News Delhi')).toBe('Teen stabbed to death in Delhi');
    expect(cleanTitle('Chain snatched - Times of India')).toBe('Chain snatched');
    expect(cleanTitle('Hit-and-run: man killed - two held')).toBe('Hit-and-run: man killed - two held');
  });
});
