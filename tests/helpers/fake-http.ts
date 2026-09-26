import type { Http, HttpResponse } from '../../src/types.js';

export function fakeHttp(routes: Record<string, Partial<HttpResponse>>): Http & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url, opts) {
      calls.push(url);
      const r = routes[url];
      if (!r) return { status: 404, body: '', format: opts?.accept ?? 'html', via: 'direct', headers: {} };
      return { status: 200, body: '', format: opts?.accept ?? 'html', via: 'direct', headers: {}, ...r };
    },
  };
}
