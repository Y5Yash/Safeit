import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadReports, resetStoreCache } from '../../src/api/store.js';
import { rep } from './fixtures.js';

const dir = mkdtempSync(join(tmpdir(), 'safeit-store-'));
afterEach(() => resetStoreCache());

describe('loadReports', () => {
  it('drops rows published before the window start and caches per path', () => {
    const path = join(dir, 'reports.json');
    const recent = rep({ title: 'recent', published_datetime: new Date(Date.now() - 86_400_000).toISOString() });
    const old = rep({ title: 'old', published_datetime: new Date(Date.now() - 200 * 86_400_000).toISOString() });
    writeFileSync(path, JSON.stringify([recent, old]));
    const a = loadReports(path);
    expect(a.map((r) => r.title)).toEqual(['recent']);
    writeFileSync(path, JSON.stringify([]));
    expect(loadReports(path)).toBe(a);
    resetStoreCache();
    expect(loadReports(path)).toEqual([]);
  });

  it('returns [] for a missing file', () => {
    expect(loadReports(join(dir, 'missing.json'))).toEqual([]);
  });

  it('derives group on every row without rewriting the file', () => {
    const path = join(dir, 'groups.json');
    const t = new Date(Date.now() - 86_400_000).toISOString();
    const rows = [
      rep({ category: 'murder', title: 'Man shot dead', published_datetime: t }),
      rep({ category: 'fraud', title: 'Tourists duped by fake taxi touts', published_datetime: t }),
      rep({ category: 'burglary_theft', title: 'House burgled', published_datetime: t }),
    ];
    const json = JSON.stringify(rows);
    writeFileSync(path, json);
    expect(loadReports(path).map((r) => r.group)).toEqual(['violent', 'transport', null]);
    expect(readFileSync(path, 'utf8')).toBe(json);
  });
});
