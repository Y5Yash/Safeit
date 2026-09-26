import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileGeoCache } from '../../src/geo/file-cache.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'safeit-geocache-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('createFileGeoCache', () => {
  it('starts empty when the file does not exist, and flush creates dirs and writes pretty JSON', async () => {
    const path = join(tmp(), 'nested', 'dir', 'geocode.json');
    const c = createFileGeoCache(path);
    expect(await c.get('delhi|nowhere')).toBeUndefined();
    await c.set('delhi|nowhere', { lat: null, lng: null, display_name: null });
    await c.set('delhi|hauz khas', { lat: 28.55, lng: 77.2, display_name: 'Hauz Khas' });
    expect(await c.get('delhi|hauz khas')).toEqual({ lat: 28.55, lng: 77.2, display_name: 'Hauz Khas' });
    await c.flush();
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('\n  "delhi|nowhere"');
    expect(JSON.parse(raw)).toEqual({
      'delhi|nowhere': { lat: null, lng: null, display_name: null },
      'delhi|hauz khas': { lat: 28.55, lng: 77.2, display_name: 'Hauz Khas' },
    });
  });

  it('loads an existing file', async () => {
    const path = join(tmp(), 'geocode.json');
    writeFileSync(path, JSON.stringify({ 'goa|calangute': { lat: 15.54, lng: 73.76, display_name: 'Calangute' } }));
    const c = createFileGeoCache(path);
    expect(await c.get('goa|calangute')).toEqual({ lat: 15.54, lng: 73.76, display_name: 'Calangute' });
    expect(await c.get('goa|other')).toBeUndefined();
  });
});
