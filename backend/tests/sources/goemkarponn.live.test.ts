import { describe, expect, it } from 'vitest';
import { createHttp } from '../../src/http/client.js';
import { goemkarponn } from '../../src/sources/goemkarponn.js';

describe.skipIf(!process.env.LIVE)('goemkarponn live', () => {
  it('returns recent crime posts with text', async () => {
    const now = new Date();
    const found = await goemkarponn.discover({ mode: 'live', since: new Date(now.getTime() - 7 * 86_400_000), until: now }, createHttp());
    expect(found.length).toBeGreaterThan(5);
    expect(found[0].article?.text.length).toBeGreaterThan(100);
  }, 60_000);
});
