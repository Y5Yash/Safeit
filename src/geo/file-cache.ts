import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GeoCache, GeoCacheValue } from '../types.js';

/** JSON-file geocode cache: loaded once, kept in memory, written back on `flush()`. */
export function createFileGeoCache(path: string): GeoCache & { flush(): Promise<void> } {
  const store = new Map<string, GeoCacheValue>();
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, GeoCacheValue>;
    for (const [k, v] of Object.entries(raw)) store.set(k, v);
  }
  return {
    async get(key) { return store.get(key); },
    async set(key, v) { store.set(key, v); },
    async flush() {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(Object.fromEntries(store), null, 2)}\n`);
    },
  };
}
