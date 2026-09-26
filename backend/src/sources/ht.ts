import { slugToTitle } from '../http/url.js';
import { parseXml, toArray } from '../http/xml.js';
import type { Candidate, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://www.hindustantimes.com';
const RSS = `${BASE}/feeds/rss/cities/delhi-news/rssfeed.xml`;
const PATH = '/cities/delhi-news/';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function monthsBetween(since: Date, until: Date): { year: number; month: string }[] {
  const out: { year: number; month: string }[] = [];
  let y = since.getUTCFullYear();
  let m = since.getUTCMonth();
  while (Date.UTC(y, m, 1) <= until.getTime()) {
    out.push({ year: y, month: MONTHS[m] });
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return out;
}

const inWindow = (d: Date | null, s: Date, u: Date) => d !== null && !Number.isNaN(d.getTime()) && d >= s && d <= u;

export const ht: SourceAdapter = {
  id: 'ht',
  name: 'Hindustan Times',
  cities: ['delhi'],

  async discover({ mode, since, until }, http) {
    const out: Candidate[] = [];
    if (mode === 'live') {
      const res = await http.get(RSS, { accept: 'xml' });
      if (res.status !== 200) throw new Error(`HT RSS HTTP ${res.status}`);
      for (const it of toArray(parseXml(res.body)?.rss?.channel?.item)) {
        const url = String(it.link ?? '');
        const publishedAt = new Date(String(it.pubDate));
        if (url.includes(PATH) && inWindow(publishedAt, since, until)) {
          out.push({ url, title: String(it.title ?? ''), publishedAt, city: 'delhi' });
        }
      }
      return out;
    }
    for (const { year, month } of monthsBetween(since, until)) {
      const res = await http.get(`${BASE}/sitemap/${month}-${year}.xml`, { accept: 'xml' });
      if (res.status !== 200) continue;
      for (const u of toArray(parseXml(res.body)?.urlset?.url)) {
        const url = String(u.loc ?? '');
        const publishedAt = u.lastmod ? new Date(String(u.lastmod)) : null;
        if (url.includes(PATH) && inWindow(publishedAt, since, until)) {
          out.push({ url, title: slugToTitle(url), publishedAt, city: 'delhi' });
        }
      }
    }
    return out;
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url, city: 'delhi', sourceName: this.name, fallbackTitle: c.title, fallbackPublishedAt: c.publishedAt,
    });
  },
};
