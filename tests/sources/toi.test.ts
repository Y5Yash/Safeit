import { describe, expect, it } from 'vitest';
import { cityFromToiUrl, toi } from '../../src/sources/toi.js';
import { fakeHttp } from '../helpers/fake-http.js';

const BASE = 'https://timesofindia.indiatimes.com';
const A1 = `${BASE}/city/delhi/man-robbed-in-shahdara/articleshow/111.cms`;
const A2 = `${BASE}/city/goa/tourist-assaulted-in-calangute/articleshow/222.cms`;
const rss = (items: string) => `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
const item = (title: string, link: string, date: string) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

describe('toi adapter', () => {
  it('reads cities from URLs', () => {
    expect(cityFromToiUrl(A1)).toBe('delhi');
    expect(cityFromToiUrl(`${BASE}/city/bengaluru/x/articleshow/1.cms`)).toBe('bengaluru');
    expect(cityFromToiUrl(`${BASE}/city/mumbai/x/articleshow/1.cms`)).toBeNull();
  });

  it('discovers live items from city RSS within the window', async () => {
    const http = fakeHttp({
      [`${BASE}/rssfeeds/-2128839596.cms`]: { body: rss(
        item('Man robbed in Shahdara', A1, '2026-09-26T08:00:00+05:30') +
        item('Old story', `${BASE}/city/delhi/old/articleshow/9.cms`, '2026-09-01T08:00:00+05:30')) },
      [`${BASE}/rssfeeds/3012535.cms`]: { body: rss(item('Tourist assaulted in Calangute', A2, '2026-09-26T09:00:00+05:30')) },
    });
    const got = await toi.discover(
      { mode: 'live', since: new Date('2026-09-25T00:00:00Z'), until: new Date('2026-09-27T00:00:00Z') }, http);
    expect(got.map((c) => [c.url, c.city, c.title])).toEqual([
      [A1, 'delhi', 'Man robbed in Shahdara'],
      [A2, 'goa', 'Tourist assaulted in Calangute'],
    ]);
  });

  it('discovers backfill URLs from month chunks overlapping the window', async () => {
    const http = fakeHttp({
      [`${BASE}/staticsitemap/toi/category/city/sitemap-index.xml`]: { body: `<sitemapindex>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-August-1.xml</loc></sitemap>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-September-1.xml</loc></sitemap>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-May-1.xml</loc></sitemap></sitemapindex>` },
      [`${BASE}/staticsitemap/toi/category/city/2026-September-1.xml`]: { body: `<urlset>
        <url><loc>${A1}</loc><lastmod>2026-09-12T10:00:00+05:30</lastmod></url>
        <url><loc>${BASE}/city/mumbai/x/articleshow/3.cms</loc><lastmod>2026-09-12T10:00:00+05:30</lastmod></url></urlset>` },
      [`${BASE}/staticsitemap/toi/category/city/2026-August-1.xml`]: { body: `<urlset>
        <url><loc>${A2}</loc><lastmod>2026-08-02T10:00:00+05:30</lastmod></url></urlset>` },
    });
    const got = await toi.discover(
      { mode: 'backfill', since: new Date('2026-08-15T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => c.url)).toEqual([A1]);
    expect(got[0].title).toBe('man robbed in shahdara');
    expect(http.calls).not.toContain(`${BASE}/staticsitemap/toi/category/city/2026-May-1.xml`);
  });

  it('fetches and parses an article', async () => {
    const html = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Man robbed in Shahdara",
      "datePublished":"2026-09-26T08:00:00+05:30","description":"d","keywords":"Shahdara","articleBody":"Body"}</script>`;
    const a = await toi.fetchArticle({ url: A1, title: 'x', publishedAt: null, city: 'delhi' }, fakeHttp({ [A1]: { body: html } }));
    expect(a).toMatchObject({ title: 'Man robbed in Shahdara', city: 'delhi', sourceName: 'Times of India', keywords: ['Shahdara'] });
  });
});
