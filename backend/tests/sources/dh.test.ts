import { describe, expect, it } from 'vitest';
import { dh } from '../../src/sources/dh.js';
import type { Http, HttpResponse } from '../../src/types.js';

function pagedHttp(pages: unknown[]): Http & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async get(url): Promise<HttpResponse> {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const body = pages[offset / 100] ?? { total: 0, items: [] };
      return { status: 200, body: JSON.stringify(body), format: 'json', via: 'direct', headers: {} };
    },
  };
}

const item = (slug: string, ms: number, url?: string) => ({
  headline: `H ${slug}`,
  slug,
  'published-at': ms,
  ...(url ? { url } : {}),
});

describe('dh adapter', () => {
  it('pages through the section API, builds URLs and dedupes', async () => {
    const t = Date.parse('2026-09-20T10:00:00Z');
    const http = pagedHttp([
      { total: 150, items: [item('bengaluru/a-1', t), item('bengaluru/b-2', t, 'https://www.deccanherald.com/bengaluru/b-2')] },
      { total: 150, items: [item('bengaluru/b-2', t), item('bengaluru/c-3', t)] },
    ]);
    const got = await dh.discover({ mode: 'backfill', since: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => c.url)).toEqual([
      'https://www.deccanherald.com/bengaluru/a-1',
      'https://www.deccanherald.com/bengaluru/b-2',
      'https://www.deccanherald.com/bengaluru/c-3',
    ]);
    expect(got[0]).toMatchObject({ title: 'H bengaluru/a-1', city: 'bengaluru', publishedAt: new Date(t) });
    const first = new URL(http.urls[0]);
    expect(first.searchParams.get('section-id')).toBe('56913');
    expect(first.searchParams.get('published-after')).toBe(String(Date.parse('2026-09-01T00:00:00Z')));
    expect(http.urls).toHaveLength(2);
  });

  it('throws on API errors so the run records it', async () => {
    const http: Http = { get: async () => ({ status: 500, body: '', format: 'json', via: 'direct', headers: {} }) };
    await expect(dh.discover({ mode: 'live', since: new Date(0), until: new Date() }, http)).rejects.toThrow(/HTTP 500/);
  });
});
