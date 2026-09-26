import type { Candidate, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://www.deccanherald.com';
const SECTION_ID = '56913';
const PAGE = 100;
const MAX_PAGES = 60;

interface Item {
  headline?: string;
  slug?: string;
  url?: string;
  'published-at'?: number;
}
interface Resp {
  total?: number;
  items?: Item[];
}

export const dh: SourceAdapter = {
  id: 'dh',
  name: 'Deccan Herald',
  cities: ['bengaluru'],

  async discover({ since, until }, http) {
    const seen = new Map<string, Candidate>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(`${BASE}/api/v1/advanced-search`);
      u.search = new URLSearchParams({
        'section-id': SECTION_ID,
        'published-after': String(since.getTime()),
        'published-before': String(until.getTime()),
        limit: String(PAGE),
        offset: String(page * PAGE),
        fields: 'headline,slug,url,published-at',
      }).toString();
      const res = await http.get(u.toString(), { accept: 'json' });
      if (res.status !== 200) throw new Error(`DH API HTTP ${res.status}`);
      const data = JSON.parse(res.body) as Resp;
      const items = data.items ?? [];
      for (const it of items) {
        const url = it.url ?? (it.slug ? `${BASE}/${it.slug.replace(/^\//, '')}` : '');
        if (!url || seen.has(url)) continue;
        seen.set(url, {
          url,
          title: it.headline ?? '',
          city: 'bengaluru',
          publishedAt: it['published-at'] ? new Date(it['published-at']) : null,
        });
      }
      if (items.length === 0 || (page + 1) * PAGE >= (data.total ?? 0)) break;
    }
    return [...seen.values()];
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url,
      city: 'bengaluru',
      sourceName: this.name,
      fallbackTitle: c.title,
      fallbackPublishedAt: c.publishedAt,
    });
  },
};
