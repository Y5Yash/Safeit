import { describe, expect, it } from 'vitest';
import { goemkarponn } from '../../src/sources/goemkarponn.js';
import type { Http, HttpResponse } from '../../src/types.js';

const post = (id: number) => ({
  id,
  date_gmt: '2026-09-20T05:30:00',
  link: `https://www.goemkarponn.com/story-${id}/`,
  title: { rendered: `Theft at Colva &#8211; case ${id}` },
  excerpt: { rendered: '<p>Colva police registered a case.</p>' },
  content: { rendered: '<p>On Friday, Colva police registered a case.</p><p>More.</p>' },
});

describe('goemkarponn adapter', () => {
  it('pages the crime category and returns pre-parsed articles', async () => {
    const urls: string[] = [];
    const http: Http = {
      async get(url): Promise<HttpResponse> {
        urls.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        return { status: 200, body: JSON.stringify(page === 1 ? [post(1), post(2)] : [post(3)]), format: 'json', via: 'direct', headers: { 'x-wp-totalpages': '2' } };
      },
    };
    const got = await goemkarponn.discover({ mode: 'live', since: new Date('2026-09-19T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got).toHaveLength(3);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('categories')).toBe('255');
    expect(q.get('after')).toBe('2026-09-19T00:00:00');
    expect(got[0].article).toEqual({
      url: 'https://www.goemkarponn.com/story-1/',
      title: 'Theft at Colva – case 1',
      publishedAt: new Date('2026-09-20T05:30:00Z'),
      description: 'Colva police registered a case.',
      text: 'On Friday, Colva police registered a case.\nMore.',
      keywords: [],
      city: 'goa',
      sourceName: 'Goemkarponn',
    });
    expect(await goemkarponn.fetchArticle(got[0], http)).toBe(got[0].article);
  });

  it('stops on an HTTP 400 past the last page', async () => {
    const http: Http = { get: async () => ({ status: 400, body: '{}', format: 'json', via: 'direct', headers: {} }) };
    expect(await goemkarponn.discover({ mode: 'live', since: new Date(0), until: new Date() }, http)).toEqual([]);
  });
});
