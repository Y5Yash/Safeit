import { describe, expect, it } from 'vitest';
import { createHttp } from '../../src/http/client.js';
import { ht } from '../../src/sources/ht.js';

describe.skipIf(!process.env.LIVE)('ht live', () => {
  it('discovers and parses a real Delhi article', async () => {
    const http = createHttp();
    const now = new Date();
    const found = await ht.discover({ mode: 'live', since: new Date(now.getTime() - 3 * 86_400_000), until: now }, http);
    expect(found.length).toBeGreaterThan(3);
    const a = await ht.fetchArticle(found[0], http);
    expect(a?.title.length).toBeGreaterThan(10);
  }, 60_000);
});
