import { describe, expect, it } from 'vitest';
import { createHttp } from '../../src/http/client.js';
import { toi } from '../../src/sources/toi.js';

describe.skipIf(!process.env.LIVE)('toi live', () => {
  it('discovers and parses a real article', async () => {
    const http = createHttp();
    const now = new Date();
    const found = await toi.discover({ mode: 'live', since: new Date(now.getTime() - 3 * 86_400_000), until: now }, http);
    expect(found.length).toBeGreaterThan(5);
    const a = await toi.fetchArticle(found[0], http);
    expect(a?.title.length).toBeGreaterThan(10);
    expect(a?.text.length).toBeGreaterThan(100);
  }, 60_000);
});
