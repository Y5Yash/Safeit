import { describe, expect, it } from 'vitest';
import { createHttp } from '../../src/http/client.js';
import { dh } from '../../src/sources/dh.js';

describe.skipIf(!process.env.LIVE)('dh live', () => {
  it('discovers and parses a real Bengaluru article', async () => {
    const http = createHttp();
    const now = new Date();
    const found = await dh.discover({ mode: 'live', since: new Date(now.getTime() - 2 * 86_400_000), until: now }, http);
    expect(found.length).toBeGreaterThan(5);
    const a = await dh.fetchArticle(found[0], http);
    expect(a?.title.length).toBeGreaterThan(10);
  }, 60_000);
});
