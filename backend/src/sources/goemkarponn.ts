import type { Candidate, SourceAdapter } from '../types.js';
import { htmlToText } from './parse-article.js';

const BASE = 'https://www.goemkarponn.com';
const CRIME_CATEGORY = '255';
const MAX_PAGES = 40;

interface WpPost {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
}

const wpDate = (d: Date) => d.toISOString().slice(0, 19);

export const goemkarponn: SourceAdapter = {
  id: 'goemkarponn',
  name: 'Goemkarponn',
  cities: ['goa'],

  async discover({ since, until }, http) {
    const out: Candidate[] = [];
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const u = new URL(`${BASE}/wp-json/wp/v2/posts`);
      u.search = new URLSearchParams({
        categories: CRIME_CATEGORY,
        after: wpDate(since),
        before: wpDate(until),
        per_page: '100',
        page: String(page),
        _fields: 'id,date_gmt,link,title,excerpt,content',
      }).toString();
      const res = await http.get(u.toString(), { accept: 'json' });
      if (res.status !== 200) break;
      totalPages = Number(res.headers['x-wp-totalpages'] ?? 1);
      for (const p of JSON.parse(res.body) as WpPost[]) {
        const publishedAt = new Date(`${p.date_gmt}Z`);
        const title = htmlToText(p.title.rendered);
        out.push({
          url: p.link,
          title,
          publishedAt,
          city: 'goa',
          article: {
            url: p.link,
            title,
            publishedAt,
            description: htmlToText(p.excerpt.rendered) || null,
            text: htmlToText(p.content.rendered),
            keywords: [],
            city: 'goa',
            sourceName: this.name,
          },
        });
      }
    }
    return out;
  },

  async fetchArticle(c) {
    return c.article ?? null;
  },
};
