import { describe, expect, it, vi } from 'vitest';
import { createHttp } from '../../src/http/client.js';

const big = '<html>' + 'x'.repeat(1000) + '</html>';
function res(status: number, body: string) { return new Response(body, { status }); }

describe('createHttp', () => {
  it('returns direct responses when OK', async () => {
    const fetchImpl = vi.fn(async () => res(200, big));
    const http = createHttp({ fetchImpl, sleep: async () => {} });
    const r = await http.get('https://a.com/x');
    expect(r).toMatchObject({ status: 200, via: 'direct', format: 'html' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to Anakin on 403 when a key is configured', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://api.anakin.io')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ url: 'https://a.com/x', country: 'in' });
        expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('k');
        return new Response(JSON.stringify({ markdown: '# Title\n\nBody' }), { status: 200 });
      }
      return res(403, 'denied');
    });
    const http = createHttp({ fetchImpl: fetchImpl as typeof fetch, anakinKey: 'k', sleep: async () => {} });
    const r = await http.get('https://a.com/x');
    expect(r).toMatchObject({ status: 200, via: 'anakin', format: 'markdown', body: '# Title\n\nBody' });
  });

  it('does not fall back without a key, for non-html, or when disabled', async () => {
    const fetchImpl = vi.fn(async () => res(403, 'denied'));
    const noKey = createHttp({ fetchImpl, sleep: async () => {} });
    expect((await noKey.get('https://a.com/x')).status).toBe(403);
    const withKey = createHttp({ fetchImpl, anakinKey: 'k', sleep: async () => {} });
    expect((await withKey.get('https://a.com/feed', { accept: 'xml' })).via).toBe('direct');
    expect((await withKey.get('https://a.com/x', { allowFallback: false })).via).toBe('direct');
  });

  it('treats tiny 200 html bodies as blocked', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('https://api.anakin.io')
        ? new Response(JSON.stringify({ markdown: 'md' }), { status: 200 })
        : res(200, ''));
    const http = createHttp({ fetchImpl: fetchImpl as typeof fetch, anakinKey: 'k', sleep: async () => {} });
    expect((await http.get('https://a.com/x')).via).toBe('anakin');
  });

  it('waits between requests to the same host', async () => {
    let t = 0;
    const sleep = vi.fn(async (ms: number) => { t += ms; });
    const http = createHttp({ fetchImpl: async () => res(200, big), sleep, now: () => t, minIntervalMs: 1000 });
    await http.get('https://a.com/1');
    await http.get('https://a.com/2');
    await http.get('https://b.com/1');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
