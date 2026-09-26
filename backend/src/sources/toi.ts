import { slugToTitle } from '../http/url.js';
import { parseXml, toArray } from '../http/xml.js';
import type { Candidate, City, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://timesofindia.indiatimes.com';
const RSS: Record<City, string> = {
  delhi: `${BASE}/rssfeeds/-2128839596.cms`,
  bengaluru: `${BASE}/rssfeeds/-2128833038.cms`,
  goa: `${BASE}/rssfeeds/3012535.cms`,
};
const INDEX = `${BASE}/staticsitemap/toi/category/city/sitemap-index.xml`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function cityFromToiUrl(url: string): City | null {
  const m = url.match(/\/city\/(delhi|bengaluru|goa)\//);
  return m ? (m[1] as City) : null;
}

function inWindow(d: Date | null, since: Date, until: Date): boolean {
  return d !== null && !Number.isNaN(d.getTime()) && d >= since && d <= until;
}

export const toi: SourceAdapter = {
  id: 'toi',
  name: 'Times of India',
  cities: ['delhi', 'bengaluru', 'goa'],

  async discover({ mode, since, until }, http) {
    const out: Candidate[] = [];
    if (mode === 'live') {
      for (const city of this.cities) {
        const res = await http.get(RSS[city], { accept: 'xml' });
        if (res.status !== 200) continue;
        for (const it of toArray(parseXml(res.body)?.rss?.channel?.item)) {
          const publishedAt = new Date(String(it.pubDate));
          const url = String(it.link ?? '');
          if (cityFromToiUrl(url) === city && inWindow(publishedAt, since, until)) {
            out.push({ url, title: String(it.title ?? ''), publishedAt, city });
          }
        }
      }
      return out;
    }
    const idx = await http.get(INDEX, { accept: 'xml' });
    if (idx.status !== 200) throw new Error(`TOI sitemap index HTTP ${idx.status}`);
    const chunks = toArray(parseXml(idx.body)?.sitemapindex?.sitemap).map((s) => String(s.loc)).filter((loc) => {
      const m = loc.match(/(\d{4})-([A-Za-z]+)-\d+\.xml$/);
      if (!m) return false;
      const month = MONTHS.indexOf(m[2].toLowerCase());
      const start = new Date(Date.UTC(Number(m[1]), month, 1));
      const end = new Date(Date.UTC(Number(m[1]), month + 1, 1));
      return month >= 0 && start < until && end > since;
    });
    for (const loc of chunks) {
      const res = await http.get(loc, { accept: 'xml' });
      if (res.status !== 200) continue;
      for (const u of toArray(parseXml(res.body)?.urlset?.url)) {
        const url = String(u.loc ?? '');
        const city = cityFromToiUrl(url);
        const publishedAt = u.lastmod ? new Date(String(u.lastmod)) : null;
        if (city && url.includes('/articleshow/') && inWindow(publishedAt, since, until)) {
          out.push({ url, title: slugToTitle(url), publishedAt, city });
        }
      }
    }
    return out;
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url, city: c.city, sourceName: this.name, fallbackTitle: c.title, fallbackPublishedAt: c.publishedAt,
    });
  },
};
