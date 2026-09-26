import type { Http, HttpGetOptions, HttpResponse } from '../types.js';

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'accept-language': 'en-IN,en;q=0.9',
};
const ACCEPT = {
  html: 'text/html,application/xhtml+xml',
  json: 'application/json',
  xml: 'application/rss+xml,application/xml,text/xml',
} as const;
const ANAKIN_URL = 'https://api.anakin.io/v1/url-scraper/scrape';
const ANAKIN_INTERVAL_MS = 3100;

export interface HttpOptions {
  anakinKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
}

export function createHttp(opts: HttpOptions = {}): Http {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 1000;
  const last = new Map<string, number>();

  async function polite(host: string, interval: number) {
    const prev = last.get(host);
    if (prev !== undefined) {
      const wait = prev + interval - now();
      if (wait > 0) await sleep(wait);
    }
    last.set(host, now());
  }

  async function viaAnakin(url: string): Promise<HttpResponse> {
    await polite('api.anakin.io', ANAKIN_INTERVAL_MS);
    const fail: HttpResponse = { status: 502, body: '', format: 'markdown', via: 'anakin', headers: {} };
    try {
      const r = await fetchImpl(ANAKIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': opts.anakinKey! },
        body: JSON.stringify({ url, useBrowser: false, generateJson: false, country: 'in' }),
        signal: AbortSignal.timeout(90_000),
      });
      if (r.status !== 200) return { ...fail, status: r.status };
      const d = (await r.json()) as { markdown?: string };
      return { status: 200, body: d.markdown ?? '', format: 'markdown', via: 'anakin', headers: {} };
    } catch {
      return fail;
    }
  }

  return {
    async get(url: string, o: HttpGetOptions = {}): Promise<HttpResponse> {
      const accept = o.accept ?? 'html';
      await polite(new URL(url).host, minInterval);
      let status = 0;
      let body = '';
      let headers: Record<string, string> = {};
      try {
        const r = await fetchImpl(url, {
          headers: { ...BROWSER_HEADERS, accept: ACCEPT[accept] },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000),
        });
        status = r.status;
        body = await r.text();
        headers = Object.fromEntries(r.headers.entries());
      } catch {
        status = 0;
      }
      const blocked = status === 0 || status === 403 || status === 429 || status >= 500 ||
        (accept === 'html' && status === 200 && body.length < 500);
      if (blocked && accept === 'html' && o.allowFallback !== false && opts.anakinKey) return viaAnakin(url);
      return { status, body, format: accept, via: 'direct', headers };
    },
  };
}
