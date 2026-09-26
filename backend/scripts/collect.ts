import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { windowStart } from '../src/config/window.js';
import { prefilter } from '../src/extract/prefilter.js';
import { createHttp } from '../src/http/client.js';
import { createResolver } from '../src/pipeline/deps.js';
import { enrichArticle } from '../src/pipeline/enrich.js';
import { sampleEvenly } from '../src/pipeline/sample.js';
import { eligibleByCity, mergeReports } from '../src/pipeline/select.js';
import { ADAPTERS } from '../src/sources/index.js';
import type { Candidate, City, Report, SourceAdapter } from '../src/types.js';

// Usage: npm run collect -- --per-source 55 [--source toi,ht] [--out data/reports.json]
const { values } = parseArgs({
  options: {
    'per-source': { type: 'string', default: '55' },
    source: { type: 'string' },
    out: { type: 'string', default: 'data/reports.json' },
  },
});
const perCity = Number(values['per-source']);
if (!Number.isInteger(perCity) || perCity <= 0) throw new Error('--per-source must be a positive integer');
const outPath = values.out!;
const wanted = values.source?.split(',').map((s) => s.trim()).filter(Boolean);
const adapters = wanted ? ADAPTERS.filter((a) => wanted.includes(a.id)) : ADAPTERS;
if (wanted && adapters.length !== wanted.length) throw new Error(`unknown source in --source ${values.source}; known: ${ADAPTERS.map((a) => a.id)}`);

/** Refill rounds: when sampled candidates are dropped (out of area, not an incident…), sample again from the rest. */
const MAX_ROUNDS = 4;

const existing: Report[] = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as Report[]) : [];
const existingLinks = new Set(existing.map((r) => r.source_link));
const fresh: Report[] = [];
const http = createHttp({ anakinKey: process.env.ANAKIN_API_KEY || undefined });
const { resolve, flush } = createResolver('data/geocode-cache.json');
const now = new Date();
const cutoff = windowStart(now.getTime());
const started = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(5)}s] ${m}`);

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  writing = writing.then(async () => {
    const rows = mergeReports(existing, fresh);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(`${outPath}.tmp`, `${JSON.stringify(rows, null, 2)}\n`);
    await rename(`${outPath}.tmp`, outPath);
    await flush();
  });
  return writing;
}

interface Stats {
  source: string; city: City | '*'; discovered: number; candidates: number; fetched: number; stored: number;
  outOfArea: number; rejected: number; failed: number;
}
const allStats: Stats[] = [];

async function runCity(adapter: SourceAdapter, city: City, pool: Candidate[], s: Stats): Promise<void> {
  let remaining = pool;
  let stored = 0;
  let tried = 0;
  for (let round = 0; round < MAX_ROUNDS && stored < perCity && remaining.length; round++) {
    const pick = sampleEvenly(remaining, perCity - stored, (c) => c.publishedAt!.getTime());
    const picked = new Set(pick);
    remaining = remaining.filter((c) => !picked.has(c));
    for (const c of pick) {
      tried++;
      const tag = `${adapter.id}/${city} #${tried} (stored ${stored}/${perCity})`;
      try {
        const article = c.article ?? (await adapter.fetchArticle(c, http));
        if (!article) { s.failed++; log(`${tag} fetch failed ${c.url}`); continue; }
        s.fetched++;
        if (article.publishedAt < cutoff || !prefilter({ title: article.title, url: c.url })) {
          s.rejected++; log(`${tag} rejected "${article.title.slice(0, 80)}"`); continue;
        }
        const row = await enrichArticle({ ...article, url: c.url, city }, { resolve });
        if (!row) { s.outOfArea++; log(`${tag} out of area "${article.title.slice(0, 80)}"`); continue; }
        if (existingLinks.has(row.source_link)) continue;
        existingLinks.add(row.source_link);
        fresh.push(row);
        stored++;
        s.stored++;
        log(`${tag} ✓ ${row.category} ${row.geo_precision} "${row.title.slice(0, 70)}"`);
      } catch (e) {
        s.failed++;
        log(`${tag} error ${c.url}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
}

async function runAdapter(adapter: SourceAdapter): Promise<void> {
  const total: Stats = { source: adapter.id, city: '*', discovered: 0, candidates: 0, fetched: 0, stored: 0, outOfArea: 0, rejected: 0, failed: 0 };
  let found: Candidate[];
  try {
    log(`${adapter.id}: discovering ${cutoff.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`);
    found = await adapter.discover({ mode: 'backfill', since: cutoff, until: now }, http);
  } catch (e) {
    log(`${adapter.id}: discover failed: ${(e as Error).message}`);
    total.failed++;
    allStats.push(total);
    return;
  }
  const { byCity, stats } = eligibleByCity(found, { cutoff, until: now, existing: existingLinks });
  log(`${adapter.id}: ${JSON.stringify(stats)}`);
  for (const city of adapter.cities) {
    const pool = byCity.get(city) ?? [];
    const s: Stats = { source: adapter.id, city, discovered: found.filter((c) => c.city === city).length, candidates: pool.length, fetched: 0, stored: 0, outOfArea: 0, rejected: 0, failed: 0 };
    await runCity(adapter, city, pool, s);
    allStats.push(s);
    log(`${adapter.id}/${city} done: ${JSON.stringify(s)}`);
    await save();
  }
}

await Promise.all(adapters.map(runAdapter));
await save();
console.log(`\nwrote ${outPath}: ${existing.length} existing + ${fresh.length} new rows`);
console.table(allStats);
