import { describe, expect, it } from 'vitest';
import { ht, monthsBetween } from '../../src/sources/ht.js';
import { fakeHttp } from '../helpers/fake-http.js';

const BASE = 'https://www.hindustantimes.com';
const A1 = `${BASE}/cities/delhi-news/woman-stabbed-in-tilak-nagar-101727000000001.html`;

describe('ht adapter', () => {
  it('lists months overlapping a window', () => {
    expect(monthsBetween(new Date('2026-07-20T00:00:00Z'), new Date('2026-09-02T00:00:00Z')))
      .toEqual([{ year: 2026, month: 'july' }, { year: 2026, month: 'august' }, { year: 2026, month: 'september' }]);
  });

  it('discovers live items from the Delhi RSS feed', async () => {
    const http = fakeHttp({
      [`${BASE}/feeds/rss/cities/delhi-news/rssfeed.xml`]: { body: `<rss><channel>
        <item><title>Woman stabbed in Tilak Nagar</title><link>${A1}</link><pubDate>Sat, 26 Sep 2026 08:00:00 +0530</pubDate></item>
      </channel></rss>` },
    });
    const got = await ht.discover({ mode: 'live', since: new Date('2026-09-25T00:00:00Z'), until: new Date('2026-09-27T00:00:00Z') }, http);
    expect(got).toEqual([{ url: A1, title: 'Woman stabbed in Tilak Nagar', publishedAt: new Date('2026-09-26T02:30:00Z'), city: 'delhi' }]);
  });

  it('discovers backfill URLs from monthly sitemaps filtered to Delhi', async () => {
    const http = fakeHttp({
      [`${BASE}/sitemap/september-2026.xml`]: { body: `<urlset>
        <url><loc>${A1}</loc><lastmod>2026-09-10T10:00:00+05:30</lastmod></url>
        <url><loc>${BASE}/cities/mumbai-news/x-101727000000002.html</loc><lastmod>2026-09-10T10:00:00+05:30</lastmod></url>
      </urlset>` },
    });
    const got = await ht.discover({ mode: 'backfill', since: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => [c.url, c.title])).toEqual([[A1, 'woman stabbed in tilak nagar']]);
  });
});
