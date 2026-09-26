# Safe-it Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vercel-hosted TypeScript backend that ingests crime/safety news for Delhi, Bengaluru and Goa, stores normalized reports in Neon Postgres, and serves heatmap + report APIs (plus an ingest endpoint for the parallel police-records work).

**Architecture:** Plain Vercel Functions (`api/*.ts`, Web `Request`/`Response` handlers, no Next.js) over a small `src/` library. Four source adapters (Times of India, Hindustan Times, Deccan Herald, Goemkarponn) discover article URLs from RSS/sitemaps/APIs, fetch pages directly (Anakin REST as fallback when blocked), and parse JSON-LD. Rule-based extractors (no LLM) derive category, incident date/time and location; a gazetteer (OpenStreetMap police stations + localities) plus Nominatim geocodes; a title-similarity dedup groups the same incident across outlets. A daily Vercel Cron plus a 3-hourly GitHub Action run live ingestion; a local CLI does the 6-month backfill (the locked data window, enforced in code).

**Tech Stack:** Node 22, TypeScript (strict, ESM/NodeNext), Vercel Functions + Cron, Neon Postgres (`@neondatabase/serverless`), PGlite for tests, Vitest, `fast-xml-parser`, `cheerio`, `zod@3`, `tsx`.

**Spec:** This plan's "Design summary" below plus the source research in `/Users/yash/MyProjects/Safe-it/research/safe-it-sources.html` and `/Users/yash/MyProjects/Safe-it/research/sources/*.md` (endpoints, volumes, caveats). Police-records context: `/Users/yash/MyProjects/Safe-it/handoff.md`.

### Design summary (the spec)

- **Record fields** (user-defined): title, category, source_name, source_link, incident date+time, location, published date+time, description. Internal additions: `source_type` (news|police|review), `city`, `lat`/`lng`, `geo_precision`, `incident_precision`, `dedup_group_id`.
- **Sources (final choice, 2 per city):** Delhi = TOI + HT; Bengaluru = TOI + Deccan Herald; Goa = Goemkarponn + TOI. Reviews deferred. Police records arrive later from another session via `POST /api/ingest`.
- **No LLM.** Native fields: title, published, description, link. Derived by rules: category (keyword taxonomy), incident time (relative-date resolver in IST), location (gazetteer → Nominatim → city fallback).
- **Heatmap:** two layers — `safety` and `fraud` — computed from weighted categories, binned into lat/lng grid cells; reports geocoded only to city level are never plotted.
- **Copyright hygiene:** store description (≤500 chars) + link, never the full article body.
- **Data window (locked): last 6 months.** Only reports published within the last 184 days (2026-03-26 → 2026-09-26 at planning time) are ingested; the window is enforced in code for news ingestion and for `/api/ingest`, and API date defaults cover the full window.
- **Hackathon security:** shared-secret bearer tokens for `/api/ingest` and `/api/cron/ingest`; public read APIs with `Access-Control-Allow-Origin: *`.

## Global Constraints

- Node `>=22`; TypeScript `strict: true`; `"type": "module"`; `module`/`moduleResolution` = `NodeNext`; relative imports use the `.js` extension (e.g. `import { x } from './y.js'`).
- No Next.js. Vercel Functions live in `api/` and export named `GET`/`POST`/`OPTIONS` functions taking a Web `Request` and returning a `Response`.
- Cities are exactly `delhi`, `bengaluru`, `goa` (lowercase ids). Timezone for all user-facing dates and date params is IST (`+05:30`).
- Data window: `WINDOW_DAYS = 184` (≈6 months). Nothing published before `windowStart()` is stored: `runIngest` clamps `since`, and `/api/ingest` rejects older records.
- Never store full article text. `description` is truncated to 500 characters.
- Outbound politeness: ≥1000 ms between direct requests to the same host; Anakin ≤20 requests/min (≥3100 ms apart); Nominatim ≤1 request/s (≥1100 ms) with User-Agent `Safeit/0.1 (+https://github.com/Y5Yash/Safeit)`.
- Secrets only via env vars: `DATABASE_URL`, `ANAKIN_API_KEY`, `INGEST_API_KEY`, `CRON_SECRET`. Never commit `.env`.
- `zod` pinned to v3 (`zod@^3.23`).
- Repo root: `/Users/yash/MyProjects/Safe-it/safeit` (clone of `https://github.com/Y5Yash/Safeit`, currently empty). All paths below are relative to it.

## Review Focus

1. **Unlocatable reports must not create a fake hotspot at the city centre** — rows with `geo_precision` `city`/`none` are excluded from `/api/heatmap` (test in Task 13).
2. **IST day boundaries** — `from=2026-09-26&to=2026-09-26` must include an item at 00:30 IST on the 26th and exclude 23:30 IST on the 25th (test in Task 13).
3. **Relative dates** — "on Friday" in an article published on a Friday means that same day; an article published 01:30 IST Saturday (Friday 20:00 UTC) resolves weekdays against Saturday IST (tests in Task 5).
4. **Re-running ingestion** (cron overlap, backfill twice, police re-POST) must not duplicate rows or crash (tests in Tasks 2, 14, 15).
5. **Out-of-area stories** (DH's Bengaluru section carries Nelamangala/Mysuru stories; TOI Goa carries Karnataka/Maharashtra items) must be dropped, not plotted (tests in Tasks 7 and 14).

---

## Parallel execution map

| Wave | Tasks (run in parallel within a wave) | Depends on |
|---|---|---|
| 1 | **T1** Scaffold, shared types, city config | — |
| 2 | **T2** DB layer · **T3** HTTP client + article parsing · **T4** Category taxonomy + prefilter · **T5** Incident time extraction · **T6** Gazetteer seed + matcher · **T7** Nominatim + location resolver · **T8** Dedup | T1 |
| 3 | **T9** TOI adapter · **T10** HT adapter · **T11** Deccan Herald adapter · **T12** Goemkarponn adapter · **T13** Read APIs (heatmap/reports/meta) | T9–T12: T1, T3 · T13: T2, T4 |
| 4 | **T14** Pipeline (enrich + runIngest + deps wiring + backfill CLI) | T2–T12 |
| 5 | **T15** Ingest API, cron endpoint, vercel.json, GitHub Action, police contract doc | T13, T14 |
| 6 | **T16** Deploy, migrate, backfill, smoke test | T15 |

Interfaces shared across waves are all declared in `src/types.ts` (Task 1), so wave-2/3 tasks can be implemented independently against those types and fakes.

---

### Task 1: Scaffold, shared types, city config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/types.ts`, `src/config/cities.ts`, `src/config/window.ts`
- Create: `docs/superpowers/plans/2026-09-26-safeit-backend.md` (copy of this plan)
- Test: `tests/config/cities.test.ts`, `tests/config/window.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in `src/types.ts` (verbatim below); `CITY_CONFIG: Record<City, CityConfig>`, `inCity(city, lat, lng): boolean`, `isCity(v): v is City` from `src/config/cities.ts`; `WINDOW_DAYS = 184`, `windowStart(now?: number): Date` from `src/config/window.ts`.

- [ ] **Step 1: Clone the repo and create the project skeleton**

```bash
cd /Users/yash/MyProjects/Safe-it
git clone https://github.com/Y5Yash/Safeit safeit
cd safeit
mkdir -p src/config tests/config docs/superpowers/plans
cp ../docs/superpowers/plans/2026-09-26-safeit-backend.md docs/superpowers/plans/
```

Create `package.json`:

```json
{
  "name": "safeit-backend",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "migrate": "tsx --env-file=.env scripts/migrate.ts",
    "seed:gazetteer": "tsx scripts/seed-gazetteer.ts",
    "backfill": "tsx --env-file=.env scripts/backfill.ts"
  }
}
```

```bash
npm i @neondatabase/serverless cheerio fast-xml-parser zod@^3.23
npm i -D typescript tsx vitest @types/node @electric-sql/pglite
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "api", "scripts", "tests"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
```

Create `.gitignore`:

```
node_modules
.env
.env.*
!.env.example
.vercel
coverage
```

Create `.env.example`:

```
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
ANAKIN_API_KEY=
INGEST_API_KEY=change-me
CRON_SECRET=change-me
```

- [ ] **Step 2: Write `src/types.ts`** (every later task imports from here — copy exactly)

```ts
export const CITIES = ['delhi', 'bengaluru', 'goa'] as const;
export type City = (typeof CITIES)[number];

export const SOURCE_TYPES = ['news', 'police', 'review'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CATEGORY_IDS = [
  'murder', 'sexual_crime', 'kidnapping', 'robbery', 'assault', 'burglary_theft',
  'drugs', 'road_accident', 'cyber_fraud', 'fraud', 'other',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export type GeoPrecision = 'exact' | 'police_station' | 'locality' | 'city' | 'none';
export type IncidentPrecision = 'datetime' | 'date' | 'unknown';

/** External record shape accepted by POST /api/ingest (dates are ISO-8601 strings with offset). */
export interface ReportInput {
  source_type: SourceType;
  source_name: string;
  source_link: string;
  title: string;
  category?: string | null;
  description?: string | null;
  incident_at?: string | null;
  published_at: string;
  city: City;
  location_text?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Fully enriched row as stored in the `reports` table. */
export interface ReportRow {
  source_type: SourceType;
  source_name: string;
  source_link: string;
  title: string;
  category: CategoryId;
  description: string | null;
  incident_at: Date | null;
  incident_precision: IncidentPrecision;
  published_at: Date;
  city: City;
  location_text: string | null;
  lat: number | null;
  lng: number | null;
  geo_precision: GeoPrecision;
  dedup_group_id: number | null;
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface HttpResponse {
  status: number;
  body: string;
  format: 'html' | 'markdown' | 'json' | 'xml';
  via: 'direct' | 'anakin';
  headers: Record<string, string>;
}
export interface HttpGetOptions {
  accept?: 'html' | 'json' | 'xml';
  allowFallback?: boolean;
}
export interface Http {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
}

/** Parsed article. `text` is used for extraction only and is never stored. */
export interface Article {
  url: string;
  title: string;
  publishedAt: Date;
  description: string | null;
  text: string;
  keywords: string[];
  city: City;
  sourceName: string;
}

export interface Candidate {
  url: string;
  title: string;
  publishedAt: Date | null;
  city: City;
  /** Set when discovery already returned the full article (e.g. WordPress API). */
  article?: Article;
}

export interface DiscoverOptions {
  mode: 'live' | 'backfill';
  since: Date;
  until: Date;
}

export interface SourceAdapter {
  id: string;
  name: string;
  cities: City[];
  discover(opts: DiscoverOptions, http: Http): Promise<Candidate[]>;
  fetchArticle(c: Candidate, http: Http): Promise<Article | null>;
}

export interface GazetteerEntry {
  name: string;
  kind: 'police_station' | 'locality';
  lat: number;
  lng: number;
}

export interface LocationInput {
  city: City;
  title: string;
  keywords: string[];
  text: string;
  location_text?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface LocationMatch {
  text: string;
  lat: number;
  lng: number;
  precision: 'police_station' | 'locality';
}

export interface ResolvedLocation {
  location_text: string | null;
  lat: number | null;
  lng: number | null;
  geo_precision: GeoPrecision;
  in_area: boolean;
}

export interface GeoCacheValue {
  lat: number | null;
  lng: number | null;
  display_name: string | null;
}
export interface GeoCache {
  get(key: string): Promise<GeoCacheValue | undefined>;
  set(key: string, v: GeoCacheValue): Promise<void>;
}
export type Geocode = (
  query: string,
  city: City,
) => Promise<{ lat: number; lng: number; display_name: string } | null>;

export interface DedupCandidate {
  id: number;
  title: string;
  published_at: Date;
  category: string;
  dedup_group_id: number | null;
}

export interface IncidentTime {
  incidentAt: Date | null;
  precision: IncidentPrecision;
}
```

- [ ] **Step 3: Write the failing test** — `tests/config/cities.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CITY_CONFIG, inCity, isCity } from '../../src/config/cities.js';

describe('cities', () => {
  it('contains points inside each city', () => {
    expect(inCity('delhi', 28.5494, 77.2001)).toBe(true); // Hauz Khas
    expect(inCity('bengaluru', 12.9352, 77.6245)).toBe(true); // Koramangala
    expect(inCity('goa', 15.5439, 73.7553)).toBe(true); // Calangute
  });
  it('rejects out-of-area points', () => {
    expect(inCity('bengaluru', 13.0976, 77.391)).toBe(false); // Nelamangala
    expect(inCity('bengaluru', 12.2958, 76.6394)).toBe(false); // Mysuru
    expect(inCity('goa', 15.8497, 74.4977)).toBe(false); // Belagavi
  });
  it('validates city ids', () => {
    expect(isCity('goa')).toBe(true);
    expect(isCity('mumbai')).toBe(false);
    expect(isCity(undefined)).toBe(false);
  });
  it('centres lie inside their own bbox', () => {
    for (const [city, c] of Object.entries(CITY_CONFIG)) {
      expect(inCity(city as 'delhi', c.center.lat, c.center.lng)).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/config/cities.test.ts`
Expected: FAIL — cannot resolve `../../src/config/cities.js`.

- [ ] **Step 5: Implement `src/config/cities.ts`**

```ts
import { CITIES, type City } from '../types.js';

export interface CityConfig {
  displayName: string;
  aliases: string[];
  center: { lat: number; lng: number };
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export const CITY_CONFIG: Record<City, CityConfig> = {
  delhi: {
    displayName: 'Delhi',
    aliases: ['delhi', 'new delhi'],
    center: { lat: 28.6139, lng: 77.209 },
    bbox: { minLat: 28.4, maxLat: 28.89, minLng: 76.83, maxLng: 77.35 },
  },
  bengaluru: {
    displayName: 'Bengaluru',
    aliases: ['bengaluru', 'bangalore'],
    center: { lat: 12.9716, lng: 77.5946 },
    bbox: { minLat: 12.8, maxLat: 13.2, minLng: 77.4, maxLng: 77.85 },
  },
  goa: {
    displayName: 'Goa',
    aliases: ['goa'],
    center: { lat: 15.4909, lng: 73.8278 },
    bbox: { minLat: 14.89, maxLat: 15.81, minLng: 73.66, maxLng: 74.34 },
  },
};

export function inCity(city: City, lat: number, lng: number): boolean {
  const b = CITY_CONFIG[city].bbox;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function isCity(v: unknown): v is City {
  return typeof v === 'string' && (CITIES as readonly string[]).includes(v);
}
```

- [ ] **Step 6: Add the 6-month data window**

`tests/config/window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WINDOW_DAYS, windowStart } from '../../src/config/window.js';

describe('data window', () => {
  it('is 184 days (≈6 months) back from now', () => {
    expect(WINDOW_DAYS).toBe(184);
    expect(windowStart(Date.parse('2026-09-26T00:00:00Z')).toISOString()).toBe('2026-03-26T00:00:00.000Z');
  });
});
```

`src/config/window.ts`:

```ts
/** Locked product decision: only the last ~6 months of reports are ingested and stored. */
export const WINDOW_DAYS = 184;

export function windowStart(now: number = Date.now()): Date {
  return new Date(now - WINDOW_DAYS * 86_400_000);
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/config && npm run typecheck`
Expected: 5 tests PASS; `tsc` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript Vercel backend with shared types, city config and 6-month window"
```

---

### Task 2: DB layer (schema, clients, reports repo, geocode cache)

**Files:**
- Create: `src/db/schema.sql`, `src/db/client.ts`, `src/db/reports-repo.ts`, `src/db/geo-cache.ts`, `scripts/migrate.ts`
- Create: `tests/helpers/test-db.ts`
- Test: `tests/db/reports-repo.test.ts`

**Interfaces:**
- Consumes: `Db`, `ReportRow`, `DedupCandidate`, `GeoCache`, `City` from `src/types.ts`.
- Produces:
  - `createNeonDb(url: string): Db`, `getDb(): Db` (`src/db/client.ts`)
  - `upsertReport(db: Db, row: ReportRow): Promise<{ id: number; inserted: boolean }>`
  - `existingLinks(db: Db, links: string[]): Promise<Set<string>>`
  - `recentForDedup(db: Db, city: City, around: Date, days?: number): Promise<DedupCandidate[]>`
  - `recordRun(db: Db, run: { source: string; mode: string; started_at: Date; finished_at: Date; stats: unknown }): Promise<void>` (all in `src/db/reports-repo.ts`)
  - `createDbGeoCache(db: Db): GeoCache` (`src/db/geo-cache.ts`)
  - `createTestDb(): Promise<Db>` (`tests/helpers/test-db.ts`, PGlite with schema applied)
  - `splitSql(sql: string): string[]` (`scripts/migrate.ts`)

- [ ] **Step 1: Write the schema** — `src/db/schema.sql`

```sql
create table if not exists reports (
  id bigserial primary key,
  source_type text not null check (source_type in ('news', 'police', 'review')),
  source_name text not null,
  source_link text not null unique,
  title text not null,
  category text not null,
  description text,
  incident_at timestamptz,
  incident_precision text not null default 'unknown' check (incident_precision in ('datetime', 'date', 'unknown')),
  published_at timestamptz not null,
  city text not null check (city in ('delhi', 'bengaluru', 'goa')),
  location_text text,
  lat double precision,
  lng double precision,
  geo_precision text not null default 'none' check (geo_precision in ('exact', 'police_station', 'locality', 'city', 'none')),
  dedup_group_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists reports_city_published_idx on reports (city, published_at);

create index if not exists reports_city_latlng_idx on reports (city, lat, lng);

create table if not exists geocode_cache (
  query text primary key,
  lat double precision,
  lng double precision,
  display_name text,
  fetched_at timestamptz not null default now()
);

create table if not exists ingest_runs (
  id bigserial primary key,
  source text not null,
  mode text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  stats jsonb not null
);
```

- [ ] **Step 2: Write the test helper** — `tests/helpers/test-db.ts`

```ts
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../src/types.js';

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query(text, params)).rows as T[],
  };
}
```

- [ ] **Step 3: Write the failing tests** — `tests/db/reports-repo.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { existingLinks, recentForDedup, recordRun, upsertReport } from '../../src/db/reports-repo.js';
import { createDbGeoCache } from '../../src/db/geo-cache.js';
import { splitSql } from '../../scripts/migrate.js';
import type { Db, ReportRow } from '../../src/types.js';

export function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    source_type: 'news', source_name: 'Times of India',
    source_link: 'https://timesofindia.indiatimes.com/city/delhi/a/articleshow/1.cms',
    title: 'Man robbed at knifepoint in Krishna Nagar', category: 'robbery',
    description: 'desc', incident_at: new Date('2026-09-11T06:00:00Z'), incident_precision: 'datetime',
    published_at: new Date('2026-09-12T04:00:00Z'), city: 'delhi', location_text: 'Krishna Nagar',
    lat: 28.656, lng: 77.28, geo_precision: 'locality', dedup_group_id: null, ...over,
  };
}

describe('reports repo', () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });

  it('inserts, then updates on the same source_link without duplicating', async () => {
    const a = await upsertReport(db, row());
    const b = await upsertReport(db, row({ title: 'Updated title' }));
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(b.id).toBe(a.id);
    const rows = await db.query<{ n: number; title: string }>('select count(*)::int as n, max(title) as title from reports');
    expect(rows[0]).toEqual({ n: 1, title: 'Updated title' });
  });

  it('returns only links that already exist', async () => {
    await upsertReport(db, row());
    const got = await existingLinks(db, [row().source_link, 'https://example.com/new']);
    expect([...got]).toEqual([row().source_link]);
    expect((await existingLinks(db, [])).size).toBe(0);
  });

  it('finds recent reports in the same city within the window', async () => {
    await upsertReport(db, row());
    await upsertReport(db, row({ source_link: 'https://x/2', published_at: new Date('2026-09-20T00:00:00Z') }));
    await upsertReport(db, row({ source_link: 'https://x/3', city: 'goa' }));
    const got = await recentForDedup(db, 'delhi', new Date('2026-09-13T00:00:00Z'));
    expect(got.map((r) => r.id)).toHaveLength(1);
    expect(got[0].published_at).toBeInstanceOf(Date);
    expect(typeof got[0].id).toBe('number');
  });

  it('records ingest runs', async () => {
    await recordRun(db, { source: 'toi', mode: 'live', started_at: new Date(), finished_at: new Date(), stats: { inserted: 2 } });
    const r = await db.query<{ n: number }>('select count(*)::int as n from ingest_runs');
    expect(r[0].n).toBe(1);
  });

  it('caches geocodes including misses', async () => {
    const cache = createDbGeoCache(db);
    expect(await cache.get('delhi|nowhere')).toBeUndefined();
    await cache.set('delhi|nowhere', { lat: null, lng: null, display_name: null });
    await cache.set('delhi|hauz khas', { lat: 28.55, lng: 77.2, display_name: 'Hauz Khas' });
    expect(await cache.get('delhi|nowhere')).toEqual({ lat: null, lng: null, display_name: null });
    expect((await cache.get('delhi|hauz khas'))?.lat).toBe(28.55);
  });

  it('splits schema into single statements for Neon', () => {
    expect(splitSql('create table a (x int);\n\ncreate index i on a (x);\n')).toEqual([
      'create table a (x int)', 'create index i on a (x)',
    ]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/db`
Expected: FAIL — modules `reports-repo.js`, `geo-cache.js`, `migrate.js` not found.

- [ ] **Step 5: Implement** `src/db/client.ts`

```ts
import { neon } from '@neondatabase/serverless';
import type { Db } from '../types.js';

export function createNeonDb(url: string): Db {
  const sql = neon(url);
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
  };
}

let cached: Db | undefined;
export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    cached = createNeonDb(url);
  }
  return cached;
}
```

`src/db/reports-repo.ts` (arrays are passed as JSON text so PGlite and Neon behave identically):

```ts
import type { City, Db, DedupCandidate, ReportRow } from '../types.js';

export async function upsertReport(db: Db, r: ReportRow): Promise<{ id: number; inserted: boolean }> {
  const rows = await db.query<{ id: number; inserted: boolean }>(
    `insert into reports (source_type, source_name, source_link, title, category, description,
       incident_at, incident_precision, published_at, city, location_text, lat, lng, geo_precision, dedup_group_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (source_link) do update set
       title = excluded.title, category = excluded.category, description = excluded.description,
       incident_at = excluded.incident_at, incident_precision = excluded.incident_precision,
       published_at = excluded.published_at, location_text = excluded.location_text,
       lat = excluded.lat, lng = excluded.lng, geo_precision = excluded.geo_precision
     returning id::int as id, (xmax = 0) as inserted`,
    [
      r.source_type, r.source_name, r.source_link, r.title, r.category, r.description,
      r.incident_at?.toISOString() ?? null, r.incident_precision, r.published_at.toISOString(),
      r.city, r.location_text, r.lat, r.lng, r.geo_precision, r.dedup_group_id,
    ],
  );
  return rows[0];
}

export async function existingLinks(db: Db, links: string[]): Promise<Set<string>> {
  if (links.length === 0) return new Set();
  const rows = await db.query<{ source_link: string }>(
    `select source_link from reports where source_link in (select jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(links)],
  );
  return new Set(rows.map((r) => r.source_link));
}

export async function recentForDedup(db: Db, city: City, around: Date, days = 2): Promise<DedupCandidate[]> {
  const ms = days * 86_400_000;
  return db.query<DedupCandidate>(
    `select id::int as id, title, published_at, category, dedup_group_id::int as dedup_group_id
     from reports where city = $1 and published_at between $2 and $3 order by id limit 500`,
    [city, new Date(around.getTime() - ms).toISOString(), new Date(around.getTime() + ms).toISOString()],
  );
}

export async function recordRun(
  db: Db,
  run: { source: string; mode: string; started_at: Date; finished_at: Date; stats: unknown },
): Promise<void> {
  await db.query(
    `insert into ingest_runs (source, mode, started_at, finished_at, stats) values ($1,$2,$3,$4,$5::jsonb)`,
    [run.source, run.mode, run.started_at.toISOString(), run.finished_at.toISOString(), JSON.stringify(run.stats)],
  );
}
```

`src/db/geo-cache.ts`:

```ts
import type { Db, GeoCache, GeoCacheValue } from '../types.js';

export function createDbGeoCache(db: Db): GeoCache {
  return {
    async get(key) {
      const rows = await db.query<GeoCacheValue>(
        'select lat, lng, display_name from geocode_cache where query = $1', [key]);
      return rows[0];
    },
    async set(key, v) {
      await db.query(
        `insert into geocode_cache (query, lat, lng, display_name) values ($1,$2,$3,$4)
         on conflict (query) do update set lat = excluded.lat, lng = excluded.lng,
           display_name = excluded.display_name, fetched_at = now()`,
        [key, v.lat, v.lng, v.display_name]);
    },
  };
}
```

`scripts/migrate.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNeonDb } from '../src/db/client.js';

export function splitSql(sql: string): string[] {
  return sql.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, '')).filter(Boolean);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createNeonDb(url);
  const schema = readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
  for (const stmt of splitSql(schema)) await db.query(stmt);
  console.log('migrated');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/db && npm run typecheck`
Expected: 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db scripts/migrate.ts tests/helpers tests/db
git commit -m "feat(db): reports schema, Neon client, upsert/dedup queries, geocode cache"
```

---

### Task 3: HTTP client (direct + Anakin fallback), XML helpers, article parsing

**Files:**
- Create: `src/http/client.ts`, `src/http/url.ts`, `src/http/xml.ts`, `src/sources/parse-article.ts`
- Create: `tests/helpers/fake-http.ts`
- Test: `tests/http/client.test.ts`, `tests/http/url.test.ts`, `tests/sources/parse-article.test.ts`

**Interfaces:**
- Consumes: `Http`, `HttpResponse`, `HttpGetOptions`, `Article`, `City` from `src/types.ts`.
- Produces:
  - `createHttp(opts?: { anakinKey?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; minIntervalMs?: number }): Http`
  - `canonicalUrl(url: string): string`, `slugToTitle(url: string): string` (`src/http/url.ts`)
  - `parseXml(xml: string): any`, `toArray<T>(v: T | T[] | undefined): T[]` (`src/http/xml.ts`)
  - `parseJsonLdArticle(html): { headline?: string; datePublished?: string; description?: string; keywords: string[]; articleBody?: string } | null`
  - `parseMeta(html): { title?: string; description?: string; publishedTime?: string; keywords: string[]; bodyText?: string }`
  - `parseMarkdownArticle(md): { title?: string; description?: string; text: string }`
  - `htmlToText(html: string): string`, `stripBoilerplate(text: string): string`
  - `articleFromResponse(res: HttpResponse, ctx: { url: string; city: City; sourceName: string; fallbackTitle?: string; fallbackPublishedAt?: Date | null }): Article | null`
  - `fakeHttp(routes: Record<string, Partial<HttpResponse>>): Http` (`tests/helpers/fake-http.ts`; unmatched URL → status 404)

- [ ] **Step 1: Write the fake Http helper** — `tests/helpers/fake-http.ts`

```ts
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
```

- [ ] **Step 2: Write failing tests**

`tests/http/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalUrl, slugToTitle } from '../../src/http/url.js';

describe('canonicalUrl', () => {
  it('forces https, lowercases host, drops query/hash and trailing slash', () => {
    expect(canonicalUrl('http://WWW.Example.com/a/b/?utm_source=x#top')).toBe('https://www.example.com/a/b');
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com/');
  });
});

describe('slugToTitle', () => {
  it('reads TOI, HT and DH slugs', () => {
    expect(slugToTitle('https://timesofindia.indiatimes.com/city/delhi/man-robbed-at-knifepoint-in-shahdara/articleshow/123456789.cms'))
      .toBe('man robbed at knifepoint in shahdara');
    expect(slugToTitle('https://www.hindustantimes.com/cities/delhi-news/woman-stabbed-in-tilak-nagar-101727000000000.html'))
      .toBe('woman stabbed in tilak nagar');
    expect(slugToTitle('https://www.deccanherald.com/india/karnataka/bengaluru/chain-snatcher-held-3712345'))
      .toBe('chain snatcher held');
  });
});
```

`tests/http/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createHttp } from '../../src/http/client.js';

const big = '<html>' + 'x'.repeat(1000) + '</html>';
function res(status: number, body: string) { return new Response(body, { status }); }

describe('createHttp', () => {
  it('returns direct responses when OK', async () => {
    const fetchImpl = vi.fn(async () => res(200, big));
    const http = createHttp({ fetchImpl, sleep: async () => {} });
    const r = await http.get('https://a.com/x');
    expect(r).toMatchObject({ status: 200, via: 'direct', format: 'html' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to Anakin on 403 when a key is configured', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://api.anakin.io')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ url: 'https://a.com/x', country: 'in' });
        expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('k');
        return new Response(JSON.stringify({ markdown: '# Title\n\nBody' }), { status: 200 });
      }
      return res(403, 'denied');
    });
    const http = createHttp({ fetchImpl: fetchImpl as typeof fetch, anakinKey: 'k', sleep: async () => {} });
    const r = await http.get('https://a.com/x');
    expect(r).toMatchObject({ status: 200, via: 'anakin', format: 'markdown', body: '# Title\n\nBody' });
  });

  it('does not fall back without a key, for non-html, or when disabled', async () => {
    const fetchImpl = vi.fn(async () => res(403, 'denied'));
    const noKey = createHttp({ fetchImpl, sleep: async () => {} });
    expect((await noKey.get('https://a.com/x')).status).toBe(403);
    const withKey = createHttp({ fetchImpl, anakinKey: 'k', sleep: async () => {} });
    expect((await withKey.get('https://a.com/feed', { accept: 'xml' })).via).toBe('direct');
    expect((await withKey.get('https://a.com/x', { allowFallback: false })).via).toBe('direct');
  });

  it('treats tiny 200 html bodies as blocked', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('https://api.anakin.io')
        ? new Response(JSON.stringify({ markdown: 'md' }), { status: 200 })
        : res(200, ''));
    const http = createHttp({ fetchImpl: fetchImpl as typeof fetch, anakinKey: 'k', sleep: async () => {} });
    expect((await http.get('https://a.com/x')).via).toBe('anakin');
  });

  it('waits between requests to the same host', async () => {
    let t = 0;
    const sleep = vi.fn(async (ms: number) => { t += ms; });
    const http = createHttp({ fetchImpl: async () => res(200, big), sleep, now: () => t, minIntervalMs: 1000 });
    await http.get('https://a.com/1');
    await http.get('https://a.com/2');
    await http.get('https://b.com/1');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
```

`tests/sources/parse-article.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  articleFromResponse, htmlToText, parseJsonLdArticle, parseMarkdownArticle, parseMeta, stripBoilerplate,
} from '../../src/sources/parse-article.js';

const TOI_HTML = `<html><head>
<meta property="og:title" content="OG title">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"x"}</script>
<script type="application/ld+json">[{"@type":"NewsArticle","headline":"Man robbed &amp; stabbed in Shahdara",
"datePublished":"2026-09-12T09:30:00+05:30","description":"A 32-year-old was robbed.",
"keywords":"Shahdara robbery, Krishna Nagar, Delhi Police",
"articleBody":"NEW DELHI: A man was robbed on Thursday around 11.30pm. You Can Also Check: Gold Rate in Delhi"}]</script>
</head><body><p>para</p></body></html>`;

describe('parse-article', () => {
  it('reads NewsArticle JSON-LD from arrays and decodes entities', () => {
    const ld = parseJsonLdArticle(TOI_HTML)!;
    expect(ld.headline).toBe('Man robbed & stabbed in Shahdara');
    expect(ld.keywords).toEqual(['Shahdara robbery', 'Krishna Nagar', 'Delhi Police']);
    expect(ld.datePublished).toBe('2026-09-12T09:30:00+05:30');
  });

  it('reads @graph JSON-LD and array keywords', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":["ReportageNewsArticle"],"headline":"H","keywords":["a","b"]}]}</script>`;
    expect(parseJsonLdArticle(html)).toMatchObject({ headline: 'H', keywords: ['a', 'b'] });
  });

  it('survives invalid JSON-LD and falls back to meta tags', () => {
    const html = `<script type="application/ld+json">{bad json</script>
      <meta property="og:title" content="Meta title"><meta name="description" content="Meta desc">
      <meta property="article:published_time" content="2026-09-01T10:00:00+05:30">
      <meta name="keywords" content="a, b"><article><p>One.</p><p>Two.</p></article>`;
    expect(parseJsonLdArticle(html)).toBeNull();
    expect(parseMeta(html)).toEqual({
      title: 'Meta title', description: 'Meta desc', publishedTime: '2026-09-01T10:00:00+05:30',
      keywords: ['a', 'b'], bodyText: 'One.\nTwo.',
    });
  });

  it('parses Anakin markdown', () => {
    const md = '# Big headline\n\nshort\n\nThis is the first long paragraph of the article, which is more than eighty characters long.\n\nMore.';
    expect(parseMarkdownArticle(md)).toEqual({
      title: 'Big headline',
      description: 'This is the first long paragraph of the article, which is more than eighty characters long.',
      text: md,
    });
  });

  it('strips TOI boilerplate and converts html to text', () => {
    expect(stripBoilerplate('Body text. You Can Also Check: Gold Rate')).toBe('Body text.');
    expect(htmlToText('<p>A &amp; B</p><p>C</p>')).toBe('A & B\nC');
  });

  it('builds an Article from an HTML response', () => {
    const a = articleFromResponse(
      { status: 200, body: TOI_HTML, format: 'html', via: 'direct', headers: {} },
      { url: 'https://toi/x', city: 'delhi', sourceName: 'Times of India' })!;
    expect(a.title).toBe('Man robbed & stabbed in Shahdara');
    expect(a.publishedAt.toISOString()).toBe('2026-09-12T04:00:00.000Z');
    expect(a.text).toBe('NEW DELHI: A man was robbed on Thursday around 11.30pm.');
    expect(a).toMatchObject({ city: 'delhi', sourceName: 'Times of India', description: 'A 32-year-old was robbed.' });
  });

  it('builds an Article from markdown using fallbacks, and returns null without a date', () => {
    const md = { status: 200, body: '# T\n\nBody', format: 'markdown' as const, via: 'anakin' as const, headers: {} };
    const ctx = { url: 'u', city: 'goa' as const, sourceName: 'S' };
    expect(articleFromResponse(md, ctx)).toBeNull();
    expect(articleFromResponse(md, { ...ctx, fallbackPublishedAt: new Date('2026-09-01T00:00:00Z') })?.title).toBe('T');
    expect(articleFromResponse({ ...md, status: 404 }, ctx)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/http tests/sources/parse-article.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/http/url.ts`:

```ts
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase();
  u.search = '';
  u.hash = '';
  let s = u.toString();
  if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function slugToTitle(url: string): string {
  const segs = new URL(url).pathname.split('/').filter(Boolean);
  const idx = segs.indexOf('articleshow');
  const seg = idx > 0 ? segs[idx - 1] : segs.filter((s) => s.includes('-')).sort((a, b) => b.length - a.length)[0] ?? '';
  return decodeURIComponent(seg)
    .replace(/\.(html?|cms)$/i, '')
    .replace(/-\d{5,}$/, '')
    .replace(/-/g, ' ')
    .trim();
}
```

`src/http/xml.ts`:

```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, trimValues: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml: string): any {
  return parser.parse(xml);
}

export function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
```

`src/http/client.ts`:

```ts
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
```

`src/sources/parse-article.ts`:

```ts
import * as cheerio from 'cheerio';
import type { Article, City, HttpResponse } from '../types.js';

const ARTICLE_TYPES = new Set(['NewsArticle', 'Article', 'ReportageNewsArticle', 'BlogPosting']);

function decode(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return cheerio.load(`<p>${s}</p>`)('p').text().trim();
}

function splitKeywords(k: unknown): string[] {
  if (Array.isArray(k)) return k.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof k === 'string') return k.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    yield o;
    if (o['@graph']) yield* walk(o['@graph']);
  }
}

export function parseJsonLdArticle(html: string) {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try { data = JSON.parse($(el).text()); } catch { continue; }
    for (const o of walk(data)) {
      const types = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
      if (!types.some((t) => ARTICLE_TYPES.has(t))) continue;
      return {
        headline: decode(o.headline as string | undefined),
        datePublished: o.datePublished as string | undefined,
        description: decode(o.description as string | undefined),
        keywords: splitKeywords(o.keywords),
        articleBody: decode(o.articleBody as string | undefined),
      };
    }
  }
  return null;
}

export function parseMeta(html: string) {
  const $ = cheerio.load(html);
  const meta = (sel: string) => $(sel).attr('content')?.trim() || undefined;
  const paras = $('article p').toArray().map((p) => $(p).text().trim()).filter(Boolean);
  return {
    title: meta('meta[property="og:title"]') ?? ($('title').text().trim() || undefined),
    description: meta('meta[property="og:description"]') ?? meta('meta[name="description"]'),
    publishedTime: meta('meta[property="article:published_time"]'),
    keywords: splitKeywords(meta('meta[name="keywords"]') ?? meta('meta[name="news_keywords"]')),
    bodyText: paras.length ? paras.join('\n') : undefined,
  };
}

export function parseMarkdownArticle(md: string) {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const description = md.split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p.length >= 80 && !p.startsWith('#') && !p.startsWith('!['));
  return { title, description, text: md };
}

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  const blocks = $('p, li, h1, h2, h3, h4').toArray().map((e) => $(e).text().trim()).filter(Boolean);
  return blocks.length ? blocks.join('\n') : $.root().text().trim();
}

export function stripBoilerplate(text: string): string {
  const cut = text.search(/You Can Also Check:/i);
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
}

function toDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function articleFromResponse(
  res: HttpResponse,
  ctx: { url: string; city: City; sourceName: string; fallbackTitle?: string; fallbackPublishedAt?: Date | null },
): Article | null {
  if (res.status !== 200 || !res.body) return null;
  let title: string | undefined;
  let publishedAt: Date | null = null;
  let description: string | null = null;
  let keywords: string[] = [];
  let text = '';
  if (res.format === 'markdown') {
    const md = parseMarkdownArticle(res.body);
    title = md.title ?? ctx.fallbackTitle;
    publishedAt = ctx.fallbackPublishedAt ?? null;
    description = md.description ?? null;
    text = md.text;
  } else {
    const ld = parseJsonLdArticle(res.body);
    const meta = parseMeta(res.body);
    title = ld?.headline ?? meta.title ?? ctx.fallbackTitle;
    publishedAt = toDate(ld?.datePublished) ?? toDate(meta.publishedTime) ?? ctx.fallbackPublishedAt ?? null;
    description = ld?.description ?? meta.description ?? null;
    keywords = ld?.keywords.length ? ld.keywords : meta.keywords;
    text = stripBoilerplate(ld?.articleBody ?? meta.bodyText ?? description ?? '');
  }
  if (!title || !publishedAt) return null;
  return { url: ctx.url, title, publishedAt, description, text, keywords, city: ctx.city, sourceName: ctx.sourceName };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/http tests/sources/parse-article.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http src/sources/parse-article.ts tests/helpers/fake-http.ts tests/http tests/sources/parse-article.test.ts
git commit -m "feat(http): polite fetcher with Anakin fallback, JSON-LD/meta/markdown article parsing"
```

---

### Task 4: Category taxonomy, classifier, prefilter

**Files:**
- Create: `src/extract/category.ts`
- Test: `tests/extract/category.test.ts`

**Interfaces:**
- Consumes: `CategoryId` from `src/types.ts`.
- Produces:
  - `CATEGORY_DEFS: { id: CategoryId; label: string; layer: 'safety' | 'fraud'; weight: number; re: RegExp | null }[]` (priority order)
  - `CATEGORY_BY_ID: Record<CategoryId, { label: string; layer: 'safety' | 'fraud'; weight: number }>`
  - `classify(text: string): CategoryId`
  - `prefilter(input: { title: string; url: string }): boolean`

- [ ] **Step 1: Write failing tests** — `tests/extract/category.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID, CATEGORY_DEFS, classify, prefilter } from '../../src/extract/category.js';
import { CATEGORY_IDS } from '../../src/types.js';

describe('classify', () => {
  it.each([
    ['Man stabbed to death in Krishna Nagar, two held', 'murder'],
    ['Biker killed after truck rams two-wheeler on ORR', 'road_accident'],
    ['Woman molested in moving auto in Indiranagar', 'sexual_crime'],
    ['Techie loses Rs 1.2 crore to digital arrest scam', 'cyber_fraud'],
    ['Chain snatchers target elderly woman in Jayanagar', 'robbery'],
    ['Two injured after group attacks youths with rods', 'assault'],
    ['Builder cheated homebuyers of Rs 4 crore', 'fraud'],
    ['Ganja worth Rs 20 lakh seized, Nigerian national held', 'drugs'],
    ['Burglars break into locked house in Margao, steal gold', 'burglary_theft'],
    ['Minor girl kidnapped from Anjuna beach shack', 'kidnapping'],
    ['Police conduct flag march ahead of festival', 'other'],
  ])('%s → %s', (text, cat) => {
    expect(classify(text)).toBe(cat);
  });
});

describe('prefilter', () => {
  const url = 'https://x.com/a';
  it('keeps incident stories', () => {
    expect(prefilter({ title: 'Youth held for snatching phone in Rohini', url })).toBe(true);
    expect(prefilter({ title: '', url: 'https://toi/city/goa/tourist-drowns-at-baga/articleshow/1.cms' })).toBe(false);
    expect(prefilter({ title: 'Three arrested in Calangute', url })).toBe(true);
  });
  it('drops court, political and non-crime stories', () => {
    expect(prefilter({ title: 'HC grants bail to accused in 2024 murder case', url })).toBe(false);
    expect(prefilter({ title: 'Congress MLA slams govt over rising crime', url })).toBe(false);
    expect(prefilter({ title: 'Delhi weather: light rain likely today', url })).toBe(false);
  });
  it('uses the URL slug when the title is empty', () => {
    expect(prefilter({ title: '', url: 'https://toi/city/delhi/man-stabbed-in-rohini/articleshow/1.cms' })).toBe(true);
  });
});

describe('taxonomy', () => {
  it('covers every CategoryId exactly once with a layer and weight', () => {
    expect(CATEGORY_DEFS.map((d) => d.id).sort()).toEqual([...CATEGORY_IDS].sort());
    expect(CATEGORY_BY_ID.cyber_fraud.layer).toBe('fraud');
    expect(CATEGORY_BY_ID.murder.weight).toBeGreaterThan(CATEGORY_BY_ID.burglary_theft.weight);
  });
});
```

Note the second `keeps` expectation: a drowning is not in the taxonomy and has no arrest word, so it is intentionally dropped (hackathon scope: crime + road safety only).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extract/category.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/extract/category.ts`

```ts
import { slugToTitle } from '../http/url.js';
import type { CategoryId } from '../types.js';

type Layer = 'safety' | 'fraud';
interface Def { id: CategoryId; label: string; layer: Layer; weight: number; re: RegExp | null }

// Priority order: first match wins.
export const CATEGORY_DEFS: Def[] = [
  { id: 'sexual_crime', label: 'Sexual crime / harassment', layer: 'safety', weight: 5,
    re: /\b(rape[ds]?|raping|gang-?rape[ds]?|molest\w*|sexual(ly)? (assault|harass)\w*|harass(ed|ment|ing)|stalk(ed|ing|er)|eve-?teas\w*|acid attack|voyeur\w*|pocso|obscene|indecent)\b/i },
  { id: 'road_accident', label: 'Road accident', layer: 'safety', weight: 2,
    re: /\b(accident|hit-and-run|hit and run|run over|mowed down|crash(ed|es)?|collid\w*|overturn\w*|rams?|rammed|skid(ded)?|mishap)\b/i },
  { id: 'murder', label: 'Murder / homicide', layer: 'safety', weight: 5,
    re: /\b(murder\w*|killed|kills?|hacked to death|stabbed to death|beaten to death|bludgeoned|shot dead|strangled|throttled|body (found|recovered)|dead body|bodies|homicide|lynch\w*|found dead)\b/i },
  { id: 'kidnapping', label: 'Kidnapping / trafficking', layer: 'safety', weight: 4,
    re: /\b(kidnap\w*|abduct\w*|trafficking|ransom)\b/i },
  { id: 'cyber_fraud', label: 'Cyber fraud', layer: 'fraud', weight: 3,
    re: /\b(cyber\w*|online (fraud|scam)|digital arrest|phishing|otp|upi|sextortion|investment (fraud|scam)|trading (fraud|scam)|fake (app|website|call cent(re|er))|deepfake|task scam|part-time job scam)\b/i },
  { id: 'robbery', label: 'Robbery / snatching', layer: 'safety', weight: 4,
    re: /\b(robb(ed|ery|er|ers|ing)|robs?|loot(ed|ing|ers)?|snatch\w*|dacoity|mugg(ed|ing|er)|waylaid|at knifepoint|at gunpoint|heist)\b/i },
  { id: 'assault', label: 'Assault / attack', layer: 'safety', weight: 3,
    re: /\b(assault\w*|attack(ed|s)?|stab(bed|bing|s)?|shot at|firing|opened fire|gunshot|thrashed|beaten|brawl|clash(ed|es)?|injur(ed|es)|road rage)\b/i },
  { id: 'fraud', label: 'Fraud / cheating', layer: 'fraud', weight: 2,
    re: /\b(fraud\w*|cheat(ed|ing|s)?|dup(ed|ing)|scam\w*|conned|forg(ed|ery)|fake|extort\w*|swindl\w*|embezzl\w*|ponzi)\b/i },
  { id: 'drugs', label: 'Drugs', layer: 'safety', weight: 2,
    re: /\b(drugs?|narcotic\w*|ndps|ganja|cannabis|charas|heroin|smack|cocaine|mdma|hashish|peddl\w*|psychotropic|lsd|mephedrone)\b/i },
  { id: 'burglary_theft', label: 'Burglary / theft', layer: 'safety', weight: 2,
    re: /\b(theft|thieves|thief|steal\w*|stole|stolen|burglar\w*|break into|break-in|broke into|house-?break\w*|pickpocket\w*|lifter)\b/i },
  { id: 'other', label: 'Other crime', layer: 'safety', weight: 1, re: null },
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORY_DEFS.map((d) => [d.id, { label: d.label, layer: d.layer, weight: d.weight }]),
) as Record<CategoryId, { label: string; layer: Layer; weight: number }>;

export function classify(text: string): CategoryId {
  for (const d of CATEGORY_DEFS) if (d.re && d.re.test(text)) return d.id;
  return 'other';
}

const ARREST_RE = /\b(arrest\w*|held|nabbed|booked|fir|detained|absconding|busted)\b/i;
const EXCLUDE_RE = /\b(court|hc|high court|supreme court|bail|verdict|sentenc\w*|convict\w*|acquit\w*|chargesheet\w*|hearing|plea|petition|judge|tribunal|opinion|editorial|minister|election|polls?|mla|mp|bjp|congress|aap|weather|rain)\b/i;

export function prefilter(input: { title: string; url: string }): boolean {
  const text = input.title?.trim() ? input.title : slugToTitle(input.url);
  if (!text || EXCLUDE_RE.test(text)) return false;
  return classify(text) !== 'other' || ARREST_RE.test(text);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/extract/category.test.ts && npm run typecheck`
Expected: all PASS. If a single `it.each` row fails, adjust only that category's regex (keep priority order) and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/extract/category.ts tests/extract/category.test.ts
git commit -m "feat(extract): crime category taxonomy with safety/fraud layers and prefilter"
```

---

### Task 5: Incident date/time extraction (IST)

**Files:**
- Create: `src/extract/incident-time.ts`
- Test: `tests/extract/incident-time.test.ts`

**Interfaces:**
- Consumes: `IncidentTime` from `src/types.ts`.
- Produces: `extractIncidentTime(text: string, publishedAt: Date): IncidentTime`; `istDate(y: number, m0: number, d: number, h?: number, min?: number): Date`.

- [ ] **Step 1: Write failing tests** — `tests/extract/incident-time.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { extractIncidentTime } from '../../src/extract/incident-time.js';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('extractIncidentTime', () => {
  it('same weekday as publish day means that day', () => {
    // 2026-09-25 is a Friday
    expect(extractIncidentTime('The incident took place on Friday.', ist('2026-09-25T18:00:00')))
      .toEqual({ incidentAt: ist('2026-09-25T00:00:00'), precision: 'date' });
  });

  it('resolves earlier weekdays backwards', () => {
    // published Thursday 2026-09-24 → Tuesday 2026-09-22
    expect(extractIncidentTime('She was attacked on Tuesday night.', ist('2026-09-24T09:00:00')))
      .toEqual({ incidentAt: ist('2026-09-22T00:00:00'), precision: 'date' });
  });

  it('combines weekday with a clock time', () => {
    // published Wednesday 2026-09-23 → Monday 2026-09-21 23:30
    expect(extractIncidentTime('Around 11.30pm on Monday, two men on a bike...', ist('2026-09-23T08:00:00')))
      .toEqual({ incidentAt: ist('2026-09-21T23:30:00'), precision: 'datetime' });
  });

  it('uses IST, not UTC, to find the publish weekday', () => {
    // 2026-09-25T20:00Z = Saturday 01:30 IST; "on Friday" → 2026-09-25
    expect(extractIncidentTime('It happened on Friday.', new Date('2026-09-25T20:00:00Z')).incidentAt)
      .toEqual(ist('2026-09-25T00:00:00'));
  });

  it('reads explicit dates, rolling back a year when needed', () => {
    expect(extractIncidentTime('The FIR says on September 11 the victim...', ist('2026-09-26T10:00:00')).incidentAt)
      .toEqual(ist('2026-09-11T00:00:00'));
    expect(extractIncidentTime('Police said on 30th December a gang...', ist('2026-01-02T10:00:00')).incidentAt)
      .toEqual(ist('2025-12-30T00:00:00'));
  });

  it('handles yesterday and 12 am', () => {
    expect(extractIncidentTime('The body was found yesterday at 12 am.', ist('2026-09-26T10:00:00')))
      .toEqual({ incidentAt: ist('2026-09-25T00:00:00'), precision: 'datetime' });
  });

  it('returns unknown when there is no date phrase', () => {
    expect(extractIncidentTime('Police have registered a case.', ist('2026-09-26T10:00:00')))
      .toEqual({ incidentAt: null, precision: 'unknown' });
  });

  it('ignores text beyond the lead', () => {
    const text = 'Police registered a case. '.repeat(80) + 'on Monday';
    expect(extractIncidentTime(text, ist('2026-09-26T10:00:00')).precision).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extract/incident-time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/extract/incident-time.ts`

```ts
import type { IncidentTime } from '../types.js';

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const EXPLICIT_RE = new RegExp(`\\bon\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}|${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`, 'i');
const WEEKDAY_RE = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const YESTERDAY_RE = /\b(yesterday|last night|previous night|intervening night)\b/i;
const TODAY_RE = /\b(today|this morning|this afternoon|earlier in the day|tonight)\b/i;
const TIME_RE = /\b(\d{1,2})(?:[.:](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.;)]|$)/i;

interface Ymd { y: number; m: number; d: number }

export function istDate(y: number, m0: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m0, d, h, min) - IST_MS);
}

function istParts(date: Date): Ymd & { dow: number } {
  const t = new Date(date.getTime() + IST_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay() };
}

function addDays(p: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(p.y, p.m, p.d) + n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

function findDay(lead: string, pub: Ymd & { dow: number }): Ymd | null {
  const ex = lead.match(EXPLICIT_RE);
  if (ex) {
    const d = Number(ex[1] ?? ex[4]);
    const m = MONTHS.indexOf((ex[2] ?? ex[3]).slice(0, 3).toLowerCase());
    if (d >= 1 && d <= 31 && m >= 0) {
      const y = Date.UTC(pub.y, m, d) > Date.UTC(pub.y, pub.m, pub.d) ? pub.y - 1 : pub.y;
      return { y, m, d };
    }
  }
  const wd = lead.match(WEEKDAY_RE);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
    return addDays(pub, -((pub.dow - target + 7) % 7));
  }
  if (YESTERDAY_RE.test(lead)) return addDays(pub, -1);
  if (TODAY_RE.test(lead)) return { y: pub.y, m: pub.m, d: pub.d };
  return null;
}

function findTime(lead: string): { h: number; min: number } | null {
  const t = lead.match(TIME_RE);
  if (!t) return null;
  let h = Number(t[1]);
  const min = Number(t[2] ?? 0);
  if (h < 1 || h > 12 || min > 59) return null;
  const pm = t[3].toLowerCase().startsWith('p');
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return { h, min };
}

export function extractIncidentTime(text: string, publishedAt: Date): IncidentTime {
  const lead = text.slice(0, 1500);
  const day = findDay(lead, istParts(publishedAt));
  if (!day) return { incidentAt: null, precision: 'unknown' };
  const time = findTime(lead);
  if (time) return { incidentAt: istDate(day.y, day.m, day.d, time.h, time.min), precision: 'datetime' };
  return { incidentAt: istDate(day.y, day.m, day.d), precision: 'date' };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/extract/incident-time.test.ts && npm run typecheck`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/incident-time.ts tests/extract/incident-time.test.ts
git commit -m "feat(extract): resolve relative incident dates and times in IST"
```

---

### Task 6: Gazetteer seed (OpenStreetMap) + location matcher

**Files:**
- Create: `scripts/seed-gazetteer.ts`, `src/geo/normalize.ts`, `src/geo/matcher.ts`
- Generate: `src/geo/gazetteer-data/{delhi,bengaluru,goa}.ts`, `src/geo/gazetteer-data/index.ts`
- Test: `tests/geo/matcher.test.ts`, `tests/geo/gazetteer-data.test.ts`

**Interfaces:**
- Consumes: `GazetteerEntry`, `LocationMatch`, `City` from `src/types.ts`; `CITY_CONFIG` from `src/config/cities.ts`.
- Produces:
  - `normalizeName(s: string): string` (`src/geo/normalize.ts`)
  - `buildMatcher(entries: GazetteerEntry[], city: City): Matcher`; `matchLocation(m: Matcher, input: { title: string; keywords: string[]; text: string }): LocationMatch | null` (`src/geo/matcher.ts`)
  - `GAZETTEER: Record<City, GazetteerEntry[]>` (`src/geo/gazetteer-data/index.ts`)

- [ ] **Step 1: Write failing matcher tests** — `tests/geo/matcher.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildMatcher, matchLocation } from '../../src/geo/matcher.js';
import { normalizeName } from '../../src/geo/normalize.js';
import type { GazetteerEntry } from '../../src/types.js';

const E: GazetteerEntry[] = [
  { name: 'Hauz Khas', kind: 'locality', lat: 28.5494, lng: 77.2001 },
  { name: 'Hauz Khas Police Station', kind: 'police_station', lat: 28.545, lng: 77.205 },
  { name: 'Krishna Nagar', kind: 'locality', lat: 28.656, lng: 77.28 },
  { name: 'Shahdara', kind: 'locality', lat: 28.673, lng: 77.289 },
  { name: 'Nagar', kind: 'locality', lat: 1, lng: 1 },
  { name: 'Delhi', kind: 'locality', lat: 2, lng: 2 },
];
const m = buildMatcher(E, 'delhi');
const input = (title: string, text = '', keywords: string[] = []) => ({ title, text, keywords });

describe('normalizeName', () => {
  it('strips police-station suffixes, punctuation and case', () => {
    expect(normalizeName('Hauz Khas Police Station')).toBe('hauz khas');
    expect(normalizeName('P.S. Shahdara')).toBe('shahdara');
    expect(normalizeName('Krishna-Nagar  PS')).toBe('krishna nagar');
  });
});

describe('matchLocation', () => {
  it('prefers an explicit police station mention', () => {
    expect(matchLocation(m, input('Man robbed', 'A case was registered at Hauz Khas police station.')))
      .toEqual({ text: 'Hauz Khas Police Station', lat: 28.545, lng: 77.205, precision: 'police_station' });
  });
  it('matches the longest locality in the title first', () => {
    expect(matchLocation(m, input('Robbery in Krishna Nagar, Shahdara'))?.text).toBe('Krishna Nagar');
  });
  it('falls back to keywords, then body text', () => {
    expect(matchLocation(m, input('Man robbed', '', ['Shahdara robbery']))?.text).toBe('Shahdara');
    expect(matchLocation(m, input('Man robbed', 'The victim lives in Shahdara.'))?.text).toBe('Shahdara');
  });
  it('ignores stoplisted/city names and partial words', () => {
    expect(matchLocation(m, input('Delhi: man robbed in some nagar'))).toBeNull();
    expect(matchLocation(m, input('Shahdaraabad incident'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/geo/matcher.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `src/geo/normalize.ts`

```ts
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bp\.\s*s\.?(?=\s|$)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(police station|police post|police chowki|thana|ps)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

`src/geo/matcher.ts`:

```ts
import { CITY_CONFIG } from '../config/cities.js';
import type { City, GazetteerEntry, LocationMatch } from '../types.js';
import { normalizeName } from './normalize.js';

const STOP_NAMES = new Set([
  'nagar', 'colony', 'market', 'village', 'sector', 'road', 'main road', 'city', 'old', 'new',
  'railway station', 'bus stand', 'extension', 'layout', 'block', 'phase', 'north', 'south', 'east', 'west',
  'central', 'india', 'police', 'station',
]);
const PS_RE = /([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+(?:police station|police post|PS)\b/g;

export interface Matcher {
  city: City;
  stations: Map<string, GazetteerEntry>;
  names: { norm: string; entry: GazetteerEntry }[];
}

export function buildMatcher(entries: GazetteerEntry[], city: City): Matcher {
  const aliases = new Set(CITY_CONFIG[city].aliases.map(normalizeName));
  const stations = new Map<string, GazetteerEntry>();
  const byNorm = new Map<string, GazetteerEntry>();
  for (const e of entries) {
    const norm = normalizeName(e.name);
    if (norm.length < 4 || STOP_NAMES.has(norm) || aliases.has(norm)) continue;
    if (e.kind === 'police_station' && !stations.has(norm)) stations.set(norm, e);
    const prev = byNorm.get(norm);
    if (!prev || (prev.kind === 'police_station' && e.kind === 'locality')) byNorm.set(norm, e);
  }
  const names = [...byNorm].map(([norm, entry]) => ({ norm, entry }))
    .sort((a, b) => b.norm.length - a.norm.length);
  return { city, stations, names };
}

function hit(e: GazetteerEntry, precision: LocationMatch['precision']): LocationMatch {
  return { text: e.name, lat: e.lat, lng: e.lng, precision };
}

export function matchLocation(
  m: Matcher,
  input: { title: string; keywords: string[]; text: string },
): LocationMatch | null {
  for (const hay of [input.title, input.text.slice(0, 3000)]) {
    for (const mm of hay.matchAll(PS_RE)) {
      const words = normalizeName(mm[1]).split(' ');
      for (let i = 0; i < words.length; i++) {
        const e = m.stations.get(words.slice(i).join(' '));
        if (e) return hit(e, 'police_station');
      }
    }
  }
  for (const hay of [input.title, input.keywords.join(' , '), input.text.slice(0, 1500)]) {
    const h = ` ${normalizeName(hay)} `;
    for (const n of m.names) {
      if (h.includes(` ${n.norm} `)) return hit(n.entry, n.entry.kind === 'police_station' ? 'police_station' : 'locality');
    }
  }
  return null;
}
```

- [ ] **Step 4: Run matcher tests**

Run: `npx vitest run tests/geo/matcher.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Write the seed script** — `scripts/seed-gazetteer.ts`

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { CITY_CONFIG } from '../src/config/cities.js';
import { normalizeName } from '../src/geo/normalize.js';
import { CITIES, type City, type GazetteerEntry } from '../src/types.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'Safeit/0.1 (+https://github.com/Y5Yash/Safeit)';
const OUT = new URL('../src/geo/gazetteer-data/', import.meta.url);

interface El { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

async function fetchCity(city: City): Promise<GazetteerEntry[]> {
  const { minLat, minLng, maxLat, maxLng } = CITY_CONFIG[city].bbox;
  const bb = `${minLat},${minLng},${maxLat},${maxLng}`;
  const q = `[out:json][timeout:180];(
    nwr["amenity"="police"]["name"](${bb});
    node["place"~"^(suburb|neighbourhood|quarter|locality|village|town|hamlet)$"]["name"](${bb});
  );out center tags;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`overpass ${city}: HTTP ${res.status}`);
  const { elements } = (await res.json()) as { elements: El[] };
  const seen = new Set<string>();
  const out: GazetteerEntry[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t['name:en'] ?? t.name;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lng === undefined || !/^[\x20-\x7E]+$/.test(name)) continue;
    const kind = t.amenity === 'police' ? 'police_station' : 'locality';
    const key = `${kind}|${normalizeName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 });
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const city of CITIES) {
    const entries = await fetchCity(city);
    writeFileSync(new URL(`${city}.ts`, OUT),
      `import type { GazetteerEntry } from '../../types.js';\n\n// Generated by scripts/seed-gazetteer.ts from OpenStreetMap (ODbL). Do not edit.\nconst data: GazetteerEntry[] = ${JSON.stringify(entries)};\n\nexport default data;\n`);
    console.log(`${city}: ${entries.length} entries (${entries.filter((e) => e.kind === 'police_station').length} police stations)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  writeFileSync(new URL('index.ts', OUT),
    `import type { City, GazetteerEntry } from '../../types.js';\nimport bengaluru from './bengaluru.js';\nimport delhi from './delhi.js';\nimport goa from './goa.js';\n\nexport const GAZETTEER: Record<City, GazetteerEntry[]> = { delhi, bengaluru, goa };\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run the seed and sanity-test the output**

Run: `npm run seed:gazetteer`
Expected: three lines like `delhi: 2500 entries (180 police stations)`. Rough expected minimums: Delhi ≥800 entries / ≥80 police stations; Bengaluru ≥500 / ≥50; Goa ≥400 / ≥15. If Overpass returns 429/504, wait 60 s and re-run.

Create `tests/geo/gazetteer-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GAZETTEER } from '../../src/geo/gazetteer-data/index.js';
import { buildMatcher, matchLocation } from '../../src/geo/matcher.js';
import { inCity } from '../../src/config/cities.js';

describe('seeded gazetteer', () => {
  it('has police stations and localities inside each city', () => {
    for (const [city, entries] of Object.entries(GAZETTEER)) {
      expect(entries.length).toBeGreaterThan(300);
      expect(entries.filter((e) => e.kind === 'police_station').length).toBeGreaterThan(10);
      // `out center` can place a boundary-crossing way's centre just outside the bbox; allow a sliver.
      expect(entries.filter((e) => inCity(city as 'goa', e.lat, e.lng)).length / entries.length).toBeGreaterThan(0.98);
    }
  });
  it('resolves well-known places', () => {
    const t = (city: 'delhi' | 'bengaluru' | 'goa', title: string) =>
      matchLocation(buildMatcher(GAZETTEER[city], city), { title, keywords: [], text: '' });
    expect(t('delhi', 'Robbery in Hauz Khas')).not.toBeNull();
    expect(t('bengaluru', 'Chain snatching in Koramangala')).not.toBeNull();
    expect(t('goa', 'Tourist assaulted in Calangute')).not.toBeNull();
  });
});
```

Run: `npx vitest run tests/geo && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-gazetteer.ts src/geo tests/geo
git commit -m "feat(geo): OSM police-station/locality gazetteer and text location matcher"
```

---

### Task 7: Nominatim geocoder + location resolver

**Files:**
- Create: `src/geo/nominatim.ts`, `src/geo/resolve.ts`
- Test: `tests/geo/nominatim.test.ts`, `tests/geo/resolve.test.ts`

**Interfaces:**
- Consumes: `GeoCache`, `Geocode`, `LocationInput`, `LocationMatch`, `ResolvedLocation`, `City` from `src/types.ts`; `CITY_CONFIG`, `inCity` from `src/config/cities.ts`.
- Produces:
  - `createNominatim(opts: { cache: GeoCache; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }): { geocode: Geocode }`
  - `extractPlacePhrase(text: string): string | null`
  - `resolveLocation(input: LocationInput, deps: { match: (i: LocationInput) => LocationMatch | null; geocode: Geocode }): Promise<ResolvedLocation>`

- [ ] **Step 1: Write failing tests**

`tests/geo/nominatim.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createNominatim, extractPlacePhrase } from '../../src/geo/nominatim.js';
import type { GeoCache, GeoCacheValue } from '../../src/types.js';

function memCache(): GeoCache & { store: Map<string, GeoCacheValue> } {
  const store = new Map<string, GeoCacheValue>();
  return { store, get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
}

describe('nominatim', () => {
  it('queries within the city viewbox with a UA, and caches hits and misses', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.searchParams.get('bounded')).toBe('1');
      expect(u.searchParams.get('countrycodes')).toBe('in');
      expect(u.searchParams.get('q')).toMatch(/, Bengaluru, India$/);
      expect((init?.headers as Record<string, string>)['user-agent']).toContain('Safeit');
      const hitBody = [{ lat: '12.93', lon: '77.62', display_name: 'Koramangala' }];
      return new Response(JSON.stringify(u.searchParams.get('q')!.startsWith('Koramangala') ? hitBody : []));
    });
    const cache = memCache();
    const n = createNominatim({ cache, fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    expect(await n.geocode('Koramangala', 'bengaluru')).toEqual({ lat: 12.93, lng: 77.62, display_name: 'Koramangala' });
    expect(await n.geocode('Nowhereville', 'bengaluru')).toBeNull();
    await n.geocode('koramangala ', 'bengaluru');
    await n.geocode('Nowhereville', 'bengaluru');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cache.store.get('bengaluru|nowhereville')).toEqual({ lat: null, lng: null, display_name: null });
  });

  it('does not cache HTTP errors', async () => {
    const cache = memCache();
    const n = createNominatim({ cache, fetchImpl: async () => new Response('busy', { status: 429 }), sleep: async () => {} });
    expect(await n.geocode('X place', 'goa')).toBeNull();
    expect(cache.store.size).toBe(0);
  });
});

describe('extractPlacePhrase', () => {
  it('finds a capitalised place after a preposition, skipping non-places', () => {
    expect(extractPlacePhrase('On Monday, a man was robbed near Silk Board Junction by two men.')).toBe('Silk Board Junction');
    expect(extractPlacePhrase('Police in Delhi said a woman in Mehrauli was attacked.')).toBe('Mehrauli');
    expect(extractPlacePhrase('no capitalised places here at all')).toBeNull();
  });
});
```

`tests/geo/resolve.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveLocation } from '../../src/geo/resolve.js';
import type { LocationInput } from '../../src/types.js';

const base: LocationInput = { city: 'bengaluru', title: 't', keywords: [], text: '' };

describe('resolveLocation', () => {
  it('uses provided coordinates first', async () => {
    const r = await resolveLocation({ ...base, lat: 12.93, lng: 77.62, location_text: 'Koramangala' },
      { match: () => null, geocode: vi.fn() });
    expect(r).toEqual({ location_text: 'Koramangala', lat: 12.93, lng: 77.62, geo_precision: 'exact', in_area: true });
  });

  it('uses the gazetteer match when available', async () => {
    const r = await resolveLocation(base, {
      match: () => ({ text: 'HSR Layout', lat: 12.91, lng: 77.64, precision: 'locality' }), geocode: vi.fn() });
    expect(r).toMatchObject({ location_text: 'HSR Layout', geo_precision: 'locality', in_area: true });
  });

  it('matches location_text for police records before free text', async () => {
    const match = vi.fn((i: LocationInput) => i.title === 'Madiwala PS'
      ? { text: 'Madiwala Police Station', lat: 12.92, lng: 77.62, precision: 'police_station' as const } : null);
    const r = await resolveLocation({ ...base, location_text: 'Madiwala PS' }, { match, geocode: vi.fn() });
    expect(r.geo_precision).toBe('police_station');
  });

  it('falls back to Nominatim on a place phrase', async () => {
    const geocode = vi.fn(async () => ({ lat: 12.917, lng: 77.623, display_name: 'Silk Board' }));
    const r = await resolveLocation({ ...base, text: 'A man was robbed near Silk Board Junction.' }, { match: () => null, geocode });
    expect(geocode).toHaveBeenCalledWith('Silk Board Junction', 'bengaluru');
    expect(r).toMatchObject({ location_text: 'Silk Board Junction', geo_precision: 'locality', in_area: true });
  });

  it('flags out-of-area results (Nelamangala) instead of plotting them', async () => {
    const r = await resolveLocation(base, {
      match: () => ({ text: 'Nelamangala', lat: 13.0976, lng: 77.391, precision: 'locality' }), geocode: vi.fn() });
    expect(r.in_area).toBe(false);
  });

  it('falls back to the city centre with city precision', async () => {
    const r = await resolveLocation(base, { match: () => null, geocode: async () => null });
    expect(r).toEqual({ location_text: null, lat: 12.9716, lng: 77.5946, geo_precision: 'city', in_area: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/geo/nominatim.test.ts tests/geo/resolve.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `src/geo/nominatim.ts`

```ts
import { CITY_CONFIG } from '../config/cities.js';
import type { City, GeoCache, Geocode } from '../types.js';

const UA = 'Safeit/0.1 (+https://github.com/Y5Yash/Safeit)';
const MIN_INTERVAL_MS = 1100;
const NOT_PLACES = new Set([
  'police', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'the', 'a', 'an',
  'delhi', 'new', 'bengaluru', 'bangalore', 'goa', 'india', 'city', 'station', 'court', 'hospital', 'january',
  'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'rs', 'fir', 'ps', 'dcp', 'acp', 'sho', 'mr', 'mrs', 'ms', 'dr',
]);
const PHRASE_RE = /\b(?:in|at|near|from|of)\s+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})/g;

export function extractPlacePhrase(text: string): string | null {
  for (const m of text.slice(0, 1500).matchAll(PHRASE_RE)) {
    const words = m[1].split(/\s+/);
    while (words.length && NOT_PLACES.has(words[words.length - 1].toLowerCase().replace(/\W/g, ''))) words.pop();
    if (!words.length || NOT_PLACES.has(words[0].toLowerCase().replace(/\W/g, ''))) continue;
    const phrase = words.join(' ').replace(/[.,]+$/, '');
    if (phrase.length >= 4) return phrase;
  }
  return null;
}

export function createNominatim(opts: {
  cache: GeoCache; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
}): { geocode: Geocode } {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  let last = -Infinity;

  const geocode: Geocode = async (query: string, city: City) => {
    const key = `${city}|${query.trim().toLowerCase()}`;
    const cached = await opts.cache.get(key);
    if (cached) return cached.lat === null || cached.lng === null ? null
      : { lat: cached.lat, lng: cached.lng, display_name: cached.display_name ?? query };
    const wait = last + MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    last = now();
    const { bbox, displayName } = CITY_CONFIG[city];
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.search = new URLSearchParams({
      q: `${query.trim()}, ${displayName}, India`, format: 'jsonv2', limit: '1', countrycodes: 'in', bounded: '1',
      viewbox: `${bbox.minLng},${bbox.maxLat},${bbox.maxLng},${bbox.minLat}`,
    }).toString();
    let res: Response;
    try { res = await fetchImpl(u.toString(), { headers: { 'user-agent': UA } }); } catch { return null; }
    if (!res.ok) return null;
    const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const h = hits[0];
    const value = h ? { lat: Number(h.lat), lng: Number(h.lon), display_name: h.display_name }
      : { lat: null, lng: null, display_name: null };
    await opts.cache.set(key, value);
    return h ? { lat: Number(h.lat), lng: Number(h.lon), display_name: h.display_name } : null;
  };
  return { geocode };
}
```

`src/geo/resolve.ts`:

```ts
import { CITY_CONFIG, inCity } from '../config/cities.js';
import type { Geocode, LocationInput, LocationMatch, ResolvedLocation } from '../types.js';
import { extractPlacePhrase } from './nominatim.js';

export async function resolveLocation(
  input: LocationInput,
  deps: { match: (i: LocationInput) => LocationMatch | null; geocode: Geocode },
): Promise<ResolvedLocation> {
  const done = (location_text: string | null, lat: number, lng: number, geo_precision: ResolvedLocation['geo_precision']) =>
    ({ location_text, lat, lng, geo_precision, in_area: inCity(input.city, lat, lng) });

  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    return done(input.location_text ?? null, input.lat, input.lng, 'exact');
  }
  if (input.location_text) {
    const m = deps.match({ ...input, title: input.location_text, keywords: [], text: '' });
    if (m) return done(m.text, m.lat, m.lng, m.precision);
    const g = await deps.geocode(input.location_text, input.city);
    if (g) return done(input.location_text, g.lat, g.lng, 'locality');
  }
  const m = deps.match(input);
  if (m) return done(m.text, m.lat, m.lng, m.precision);
  const phrase = extractPlacePhrase(input.text);
  if (phrase) {
    const g = await deps.geocode(phrase, input.city);
    if (g) return done(phrase, g.lat, g.lng, 'locality');
  }
  const c = CITY_CONFIG[input.city].center;
  return { location_text: input.location_text ?? null, lat: c.lat, lng: c.lng, geo_precision: 'city', in_area: true };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/geo/nominatim.test.ts tests/geo/resolve.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/geo/nominatim.ts src/geo/resolve.ts tests/geo/nominatim.test.ts tests/geo/resolve.test.ts
git commit -m "feat(geo): cached Nominatim fallback and location resolver with in-area check"
```

---

### Task 8: Cross-source dedup

**Files:**
- Create: `src/pipeline/dedup.ts`
- Test: `tests/pipeline/dedup.test.ts`

**Interfaces:**
- Consumes: `DedupCandidate` from `src/types.ts`.
- Produces: `titleTokens(title: string): Set<string>`; `findDuplicate(c: { title: string; publishedAt: Date }, recent: DedupCandidate[], opts?: { threshold?: number; windowDays?: number }): DedupCandidate | null`.

- [ ] **Step 1: Write failing tests** — `tests/pipeline/dedup.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { findDuplicate, titleTokens } from '../../src/pipeline/dedup.js';
import type { DedupCandidate } from '../../src/types.js';

const at = new Date('2026-09-12T10:00:00Z');
const cand = (over: Partial<DedupCandidate>): DedupCandidate =>
  ({ id: 1, title: '', published_at: at, category: 'murder', dedup_group_id: null, ...over });

describe('dedup', () => {
  it('stems and drops stopwords/generic words', () => {
    expect([...titleTokens('Two arrested for stabbing man to death in Krishna Nagar')].sort())
      .toEqual(['death', 'krishna', 'nagar', 'stabb', 'two']);
  });
  it('matches the same incident across outlets', () => {
    const recent = [cand({ id: 7, title: 'Man stabbed to death in Krishna Nagar, two held', dedup_group_id: 3 })];
    expect(findDuplicate({ title: 'Two arrested for stabbing man to death in Krishna Nagar', publishedAt: at }, recent)?.id).toBe(7);
  });
  it('does not match different incidents or distant dates', () => {
    const recent = [cand({ title: 'Woman duped of Rs 5 lakh in digital arrest scam' })];
    expect(findDuplicate({ title: 'Man stabbed to death in Krishna Nagar', publishedAt: at }, recent)).toBeNull();
    const far = [cand({ title: 'Man stabbed to death in Krishna Nagar', published_at: new Date('2026-09-20T10:00:00Z') })];
    expect(findDuplicate({ title: 'Man stabbed to death in Krishna Nagar', publishedAt: at }, far)).toBeNull();
  });
  it('picks the most similar candidate', () => {
    const recent = [
      cand({ id: 1, title: 'Man stabbed in Krishna Nagar market' }),
      cand({ id: 2, title: 'Man stabbed to death in Krishna Nagar' }),
    ];
    expect(findDuplicate({ title: 'Man stabbed to death in Krishna Nagar', publishedAt: at }, recent)?.id).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pipeline/dedup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/pipeline/dedup.ts`

```ts
import type { DedupCandidate } from '../types.js';

const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'for', 'to', 'by', 'with', 'from', 'and', 'or', 'after', 'over',
  'into', 'as', 'is', 'was', 'his', 'her', 'their', 'its', 'rs', 'lakh', 'crore', 'police', 'cops', 'delhi',
  'bengaluru', 'bangalore', 'goa', 'held', 'arrested', 'arrest', 'man', 'woman', 'case', 'booked', 'news',
]);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map(stem),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function findDuplicate(
  c: { title: string; publishedAt: Date },
  recent: DedupCandidate[],
  opts: { threshold?: number; windowDays?: number } = {},
): DedupCandidate | null {
  const threshold = opts.threshold ?? 0.5;
  const windowMs = (opts.windowDays ?? 2) * 86_400_000;
  const tokens = titleTokens(c.title);
  let best: DedupCandidate | null = null;
  let bestScore = threshold;
  for (const r of recent) {
    if (Math.abs(r.published_at.getTime() - c.publishedAt.getTime()) > windowMs) continue;
    const s = jaccard(tokens, titleTokens(r.title));
    if (s >= bestScore && (best === null || s > bestScore)) { best = r; bestScore = s; }
  }
  return best;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/pipeline/dedup.test.ts && npm run typecheck`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/dedup.ts tests/pipeline/dedup.test.ts
git commit -m "feat(pipeline): title-similarity dedup across outlets"
```

---

### Task 9: Times of India adapter (Delhi, Bengaluru, Goa)

**Files:**
- Create: `src/sources/toi.ts`
- Test: `tests/sources/toi.test.ts`, `tests/sources/toi.live.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `Candidate`, `City`, `Http` (types); `parseXml`, `toArray` (`src/http/xml.ts`); `slugToTitle` (`src/http/url.ts`); `articleFromResponse` (`src/sources/parse-article.ts`); `fakeHttp` (tests).
- Produces: `toi: SourceAdapter` with `id: 'toi'`, `name: 'Times of India'`, `cities: ['delhi','bengaluru','goa']`; `cityFromToiUrl(url: string): City | null`.

Endpoints (from `research/sources/toi.md`): city RSS `https://timesofindia.indiatimes.com/rssfeeds/{-2128839596|-2128833038|3012535}.cms` (Delhi|Bengaluru|Goa, ~20 items/day); monthly sitemap index `https://timesofindia.indiatimes.com/staticsitemap/toi/category/city/sitemap-index.xml` with chunks named `YYYY-Month-N.xml` containing `<url><loc/><lastmod/></url>`.

- [ ] **Step 1: Write failing tests** — `tests/sources/toi.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { cityFromToiUrl, toi } from '../../src/sources/toi.js';
import { fakeHttp } from '../helpers/fake-http.js';

const BASE = 'https://timesofindia.indiatimes.com';
const A1 = `${BASE}/city/delhi/man-robbed-in-shahdara/articleshow/111.cms`;
const A2 = `${BASE}/city/goa/tourist-assaulted-in-calangute/articleshow/222.cms`;
const rss = (items: string) => `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
const item = (title: string, link: string, date: string) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

describe('toi adapter', () => {
  it('reads cities from URLs', () => {
    expect(cityFromToiUrl(A1)).toBe('delhi');
    expect(cityFromToiUrl(`${BASE}/city/bengaluru/x/articleshow/1.cms`)).toBe('bengaluru');
    expect(cityFromToiUrl(`${BASE}/city/mumbai/x/articleshow/1.cms`)).toBeNull();
  });

  it('discovers live items from city RSS within the window', async () => {
    const http = fakeHttp({
      [`${BASE}/rssfeeds/-2128839596.cms`]: { body: rss(
        item('Man robbed in Shahdara', A1, '2026-09-26T08:00:00+05:30') +
        item('Old story', `${BASE}/city/delhi/old/articleshow/9.cms`, '2026-09-01T08:00:00+05:30')) },
      [`${BASE}/rssfeeds/3012535.cms`]: { body: rss(item('Tourist assaulted in Calangute', A2, '2026-09-26T09:00:00+05:30')) },
    });
    const got = await toi.discover(
      { mode: 'live', since: new Date('2026-09-25T00:00:00Z'), until: new Date('2026-09-27T00:00:00Z') }, http);
    expect(got.map((c) => [c.url, c.city, c.title])).toEqual([
      [A1, 'delhi', 'Man robbed in Shahdara'],
      [A2, 'goa', 'Tourist assaulted in Calangute'],
    ]);
  });

  it('discovers backfill URLs from month chunks overlapping the window', async () => {
    const http = fakeHttp({
      [`${BASE}/staticsitemap/toi/category/city/sitemap-index.xml`]: { body: `<sitemapindex>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-August-1.xml</loc></sitemap>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-September-1.xml</loc></sitemap>
        <sitemap><loc>${BASE}/staticsitemap/toi/category/city/2026-May-1.xml</loc></sitemap></sitemapindex>` },
      [`${BASE}/staticsitemap/toi/category/city/2026-September-1.xml`]: { body: `<urlset>
        <url><loc>${A1}</loc><lastmod>2026-09-12T10:00:00+05:30</lastmod></url>
        <url><loc>${BASE}/city/mumbai/x/articleshow/3.cms</loc><lastmod>2026-09-12T10:00:00+05:30</lastmod></url></urlset>` },
      [`${BASE}/staticsitemap/toi/category/city/2026-August-1.xml`]: { body: `<urlset>
        <url><loc>${A2}</loc><lastmod>2026-08-02T10:00:00+05:30</lastmod></url></urlset>` },
    });
    const got = await toi.discover(
      { mode: 'backfill', since: new Date('2026-08-15T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => c.url)).toEqual([A1]);
    expect(got[0].title).toBe('man robbed in shahdara');
    expect(http.calls).not.toContain(`${BASE}/staticsitemap/toi/category/city/2026-May-1.xml`);
  });

  it('fetches and parses an article', async () => {
    const html = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"Man robbed in Shahdara",
      "datePublished":"2026-09-26T08:00:00+05:30","description":"d","keywords":"Shahdara","articleBody":"Body"}</script>`;
    const a = await toi.fetchArticle({ url: A1, title: 'x', publishedAt: null, city: 'delhi' }, fakeHttp({ [A1]: { body: html } }));
    expect(a).toMatchObject({ title: 'Man robbed in Shahdara', city: 'delhi', sourceName: 'Times of India', keywords: ['Shahdara'] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sources/toi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/sources/toi.ts`

```ts
import { slugToTitle } from '../http/url.js';
import { parseXml, toArray } from '../http/xml.js';
import type { Candidate, City, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://timesofindia.indiatimes.com';
const RSS: Record<City, string> = {
  delhi: `${BASE}/rssfeeds/-2128839596.cms`,
  bengaluru: `${BASE}/rssfeeds/-2128833038.cms`,
  goa: `${BASE}/rssfeeds/3012535.cms`,
};
const INDEX = `${BASE}/staticsitemap/toi/category/city/sitemap-index.xml`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function cityFromToiUrl(url: string): City | null {
  const m = url.match(/\/city\/(delhi|bengaluru|goa)\//);
  return m ? (m[1] as City) : null;
}

function inWindow(d: Date | null, since: Date, until: Date): boolean {
  return d !== null && !Number.isNaN(d.getTime()) && d >= since && d <= until;
}

export const toi: SourceAdapter = {
  id: 'toi',
  name: 'Times of India',
  cities: ['delhi', 'bengaluru', 'goa'],

  async discover({ mode, since, until }, http) {
    const out: Candidate[] = [];
    if (mode === 'live') {
      for (const city of this.cities) {
        const res = await http.get(RSS[city], { accept: 'xml' });
        if (res.status !== 200) continue;
        for (const it of toArray(parseXml(res.body)?.rss?.channel?.item)) {
          const publishedAt = new Date(String(it.pubDate));
          const url = String(it.link ?? '');
          if (cityFromToiUrl(url) === city && inWindow(publishedAt, since, until)) {
            out.push({ url, title: String(it.title ?? ''), publishedAt, city });
          }
        }
      }
      return out;
    }
    const idx = await http.get(INDEX, { accept: 'xml' });
    if (idx.status !== 200) throw new Error(`TOI sitemap index HTTP ${idx.status}`);
    const chunks = toArray(parseXml(idx.body)?.sitemapindex?.sitemap).map((s) => String(s.loc)).filter((loc) => {
      const m = loc.match(/(\d{4})-([A-Za-z]+)-\d+\.xml$/);
      if (!m) return false;
      const month = MONTHS.indexOf(m[2].toLowerCase());
      const start = new Date(Date.UTC(Number(m[1]), month, 1));
      const end = new Date(Date.UTC(Number(m[1]), month + 1, 1));
      return month >= 0 && start < until && end > since;
    });
    for (const loc of chunks) {
      const res = await http.get(loc, { accept: 'xml' });
      if (res.status !== 200) continue;
      for (const u of toArray(parseXml(res.body)?.urlset?.url)) {
        const url = String(u.loc ?? '');
        const city = cityFromToiUrl(url);
        const publishedAt = u.lastmod ? new Date(String(u.lastmod)) : null;
        if (city && url.includes('/articleshow/') && inWindow(publishedAt, since, until)) {
          out.push({ url, title: slugToTitle(url), publishedAt, city });
        }
      }
    }
    return out;
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url, city: c.city, sourceName: this.name, fallbackTitle: c.title, fallbackPublishedAt: c.publishedAt,
    });
  },
};
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/sources/toi.test.ts && npm run typecheck`
Expected: 4 tests PASS.

- [ ] **Step 5: Add a live smoke test** — `tests/sources/toi.live.test.ts`

```ts
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
```

Run: `LIVE=1 npx vitest run tests/sources/toi.live.test.ts`
Expected: PASS. If the RSS `link` field contains tracking suffixes or a different host, adjust `cityFromToiUrl`/parsing to the real shape and add that shape to the unit test.

- [ ] **Step 6: Commit**

```bash
git add src/sources/toi.ts tests/sources/toi.test.ts tests/sources/toi.live.test.ts
git commit -m "feat(sources): Times of India adapter (city RSS + monthly sitemap backfill)"
```

---

### Task 10: Hindustan Times adapter (Delhi)

**Files:**
- Create: `src/sources/ht.ts`
- Test: `tests/sources/ht.test.ts`, `tests/sources/ht.live.test.ts`

**Interfaces:**
- Consumes: same as Task 9.
- Produces: `ht: SourceAdapter` with `id: 'ht'`, `name: 'Hindustan Times'`, `cities: ['delhi']`; `monthsBetween(since: Date, until: Date): { year: number; month: string }[]`.

Endpoints (from `research/sources/national_ht_ie_ndtv.md`): RSS `https://www.hindustantimes.com/feeds/rss/cities/delhi-news/rssfeed.xml`; complete monthly sitemaps `https://www.hindustantimes.com/sitemap/{month}-{year}.xml` (e.g. `september-2026.xml`); Delhi URLs contain `/cities/delhi-news/`.

- [ ] **Step 1: Write failing tests** — `tests/sources/ht.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ht, monthsBetween } from '../../src/sources/ht.js';
import { fakeHttp } from '../helpers/fake-http.js';

const BASE = 'https://www.hindustantimes.com';
const A1 = `${BASE}/cities/delhi-news/woman-stabbed-in-tilak-nagar-101727000000001.html`;

describe('ht adapter', () => {
  it('lists months overlapping a window', () => {
    expect(monthsBetween(new Date('2026-07-20T00:00:00Z'), new Date('2026-09-02T00:00:00Z')))
      .toEqual([{ year: 2026, month: 'july' }, { year: 2026, month: 'august' }, { year: 2026, month: 'september' }]);
  });

  it('discovers live items from the Delhi RSS feed', async () => {
    const http = fakeHttp({
      [`${BASE}/feeds/rss/cities/delhi-news/rssfeed.xml`]: { body: `<rss><channel>
        <item><title>Woman stabbed in Tilak Nagar</title><link>${A1}</link><pubDate>Sat, 26 Sep 2026 08:00:00 +0530</pubDate></item>
      </channel></rss>` },
    });
    const got = await ht.discover({ mode: 'live', since: new Date('2026-09-25T00:00:00Z'), until: new Date('2026-09-27T00:00:00Z') }, http);
    expect(got).toEqual([{ url: A1, title: 'Woman stabbed in Tilak Nagar', publishedAt: new Date('2026-09-26T02:30:00Z'), city: 'delhi' }]);
  });

  it('discovers backfill URLs from monthly sitemaps filtered to Delhi', async () => {
    const http = fakeHttp({
      [`${BASE}/sitemap/september-2026.xml`]: { body: `<urlset>
        <url><loc>${A1}</loc><lastmod>2026-09-10T10:00:00+05:30</lastmod></url>
        <url><loc>${BASE}/cities/mumbai-news/x-101727000000002.html</loc><lastmod>2026-09-10T10:00:00+05:30</lastmod></url>
      </urlset>` },
    });
    const got = await ht.discover({ mode: 'backfill', since: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => [c.url, c.title])).toEqual([[A1, 'woman stabbed in tilak nagar']]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sources/ht.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/sources/ht.ts`

```ts
import { slugToTitle } from '../http/url.js';
import { parseXml, toArray } from '../http/xml.js';
import type { Candidate, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://www.hindustantimes.com';
const RSS = `${BASE}/feeds/rss/cities/delhi-news/rssfeed.xml`;
const PATH = '/cities/delhi-news/';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function monthsBetween(since: Date, until: Date): { year: number; month: string }[] {
  const out: { year: number; month: string }[] = [];
  let y = since.getUTCFullYear();
  let m = since.getUTCMonth();
  while (Date.UTC(y, m, 1) <= until.getTime()) {
    out.push({ year: y, month: MONTHS[m] });
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return out;
}

const inWindow = (d: Date | null, s: Date, u: Date) => d !== null && !Number.isNaN(d.getTime()) && d >= s && d <= u;

export const ht: SourceAdapter = {
  id: 'ht',
  name: 'Hindustan Times',
  cities: ['delhi'],

  async discover({ mode, since, until }, http) {
    const out: Candidate[] = [];
    if (mode === 'live') {
      const res = await http.get(RSS, { accept: 'xml' });
      if (res.status !== 200) throw new Error(`HT RSS HTTP ${res.status}`);
      for (const it of toArray(parseXml(res.body)?.rss?.channel?.item)) {
        const url = String(it.link ?? '');
        const publishedAt = new Date(String(it.pubDate));
        if (url.includes(PATH) && inWindow(publishedAt, since, until)) {
          out.push({ url, title: String(it.title ?? ''), publishedAt, city: 'delhi' });
        }
      }
      return out;
    }
    for (const { year, month } of monthsBetween(since, until)) {
      const res = await http.get(`${BASE}/sitemap/${month}-${year}.xml`, { accept: 'xml' });
      if (res.status !== 200) continue;
      for (const u of toArray(parseXml(res.body)?.urlset?.url)) {
        const url = String(u.loc ?? '');
        const publishedAt = u.lastmod ? new Date(String(u.lastmod)) : null;
        if (url.includes(PATH) && inWindow(publishedAt, since, until)) {
          out.push({ url, title: slugToTitle(url), publishedAt, city: 'delhi' });
        }
      }
    }
    return out;
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url, city: 'delhi', sourceName: this.name, fallbackTitle: c.title, fallbackPublishedAt: c.publishedAt,
    });
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sources/ht.test.ts && npm run typecheck`
Expected: 3 tests PASS.

- [ ] **Step 5: Live smoke test** — `tests/sources/ht.live.test.ts`

```ts
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
```

Run: `LIVE=1 npx vitest run tests/sources/ht.live.test.ts`
Expected: PASS. If the RSS `link` differs from `/cities/delhi-news/` URLs (e.g. AMP links), normalise it and add a unit test for that shape.

- [ ] **Step 6: Commit**

```bash
git add src/sources/ht.ts tests/sources/ht.test.ts tests/sources/ht.live.test.ts
git commit -m "feat(sources): Hindustan Times Delhi adapter (RSS + monthly sitemaps)"
```

---

### Task 11: Deccan Herald adapter (Bengaluru, Quintype API)

**Files:**
- Create: `src/sources/dh.ts`
- Test: `tests/sources/dh.test.ts`, `tests/sources/dh.live.test.ts`

**Interfaces:**
- Consumes: same as Task 9.
- Produces: `dh: SourceAdapter` with `id: 'dh'`, `name: 'Deccan Herald'`, `cities: ['bengaluru']`.

Endpoint (from `research/sources/bangalore_regional.md`): `GET https://www.deccanherald.com/api/v1/advanced-search?section-id=56913&published-after=<ms>&published-before=<ms>&limit=100&offset=N&fields=headline,slug,url,published-at` → `{ total, items: [...] }`. Pagination returns ~10–20% duplicates, so dedupe by URL. Live and backfill use the same call with different windows.

- [ ] **Step 1: Verify the real response shape**

Run:

```bash
curl -s -A "Mozilla/5.0" "https://www.deccanherald.com/api/v1/advanced-search?section-id=56913&published-after=$(( ($(date +%s) - 86400) * 1000 ))&limit=2&fields=headline,slug,url,published-at" | head -c 800; echo
```

Expected: JSON with a numeric `total` and an `items` array whose entries have `headline`, `slug`, `published-at` (ms epoch) and usually `url`. If the key names differ (for example the array is nested under `results`), update the `Resp` type and the fixture below to match the real shape before continuing.

- [ ] **Step 2: Write failing tests** — `tests/sources/dh.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { dh } from '../../src/sources/dh.js';
import type { Http, HttpResponse } from '../../src/types.js';

function pagedHttp(pages: unknown[]): Http & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async get(url): Promise<HttpResponse> {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const body = pages[offset / 100] ?? { total: 0, items: [] };
      return { status: 200, body: JSON.stringify(body), format: 'json', via: 'direct', headers: {} };
    },
  };
}

const item = (slug: string, ms: number, url?: string) => ({ headline: `H ${slug}`, slug, 'published-at': ms, ...(url ? { url } : {}) });

describe('dh adapter', () => {
  it('pages through the section API, builds URLs and dedupes', async () => {
    const t = Date.parse('2026-09-20T10:00:00Z');
    const http = pagedHttp([
      { total: 150, items: [item('bengaluru/a-1', t), item('bengaluru/b-2', t, 'https://www.deccanherald.com/bengaluru/b-2')] },
      { total: 150, items: [item('bengaluru/b-2', t), item('bengaluru/c-3', t)] },
    ]);
    const got = await dh.discover({ mode: 'backfill', since: new Date('2026-09-01T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got.map((c) => c.url)).toEqual([
      'https://www.deccanherald.com/bengaluru/a-1',
      'https://www.deccanherald.com/bengaluru/b-2',
      'https://www.deccanherald.com/bengaluru/c-3',
    ]);
    expect(got[0]).toMatchObject({ title: 'H bengaluru/a-1', city: 'bengaluru', publishedAt: new Date(t) });
    const first = new URL(http.urls[0]);
    expect(first.searchParams.get('section-id')).toBe('56913');
    expect(first.searchParams.get('published-after')).toBe(String(Date.parse('2026-09-01T00:00:00Z')));
    expect(http.urls).toHaveLength(2);
  });

  it('throws on API errors so the run records it', async () => {
    const http: Http = { get: async () => ({ status: 500, body: '', format: 'json', via: 'direct', headers: {} }) };
    await expect(dh.discover({ mode: 'live', since: new Date(0), until: new Date() }, http)).rejects.toThrow(/HTTP 500/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/sources/dh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `src/sources/dh.ts`

```ts
import type { Candidate, SourceAdapter } from '../types.js';
import { articleFromResponse } from './parse-article.js';

const BASE = 'https://www.deccanherald.com';
const SECTION_ID = '56913';
const PAGE = 100;
const MAX_PAGES = 60;

interface Item { headline?: string; slug?: string; url?: string; 'published-at'?: number }
interface Resp { total?: number; items?: Item[] }

export const dh: SourceAdapter = {
  id: 'dh',
  name: 'Deccan Herald',
  cities: ['bengaluru'],

  async discover({ since, until }, http) {
    const seen = new Map<string, Candidate>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(`${BASE}/api/v1/advanced-search`);
      u.search = new URLSearchParams({
        'section-id': SECTION_ID,
        'published-after': String(since.getTime()),
        'published-before': String(until.getTime()),
        limit: String(PAGE),
        offset: String(page * PAGE),
        fields: 'headline,slug,url,published-at',
      }).toString();
      const res = await http.get(u.toString(), { accept: 'json' });
      if (res.status !== 200) throw new Error(`DH API HTTP ${res.status}`);
      const data = JSON.parse(res.body) as Resp;
      const items = data.items ?? [];
      for (const it of items) {
        const url = it.url ?? (it.slug ? `${BASE}/${it.slug.replace(/^\//, '')}` : '');
        if (!url || seen.has(url)) continue;
        seen.set(url, {
          url, title: it.headline ?? '', city: 'bengaluru',
          publishedAt: it['published-at'] ? new Date(it['published-at']) : null,
        });
      }
      if (items.length === 0 || (page + 1) * PAGE >= (data.total ?? 0)) break;
    }
    return [...seen.values()];
  },

  async fetchArticle(c, http) {
    const res = await http.get(c.url, { accept: 'html' });
    return articleFromResponse(res, {
      url: c.url, city: 'bengaluru', sourceName: this.name, fallbackTitle: c.title, fallbackPublishedAt: c.publishedAt,
    });
  },
};
```

- [ ] **Step 5: Run tests, then the live smoke test**

`tests/sources/dh.live.test.ts`:

```ts
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
```

Run: `npx vitest run tests/sources/dh.test.ts && LIVE=1 npx vitest run tests/sources/dh.live.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/dh.ts tests/sources/dh.test.ts tests/sources/dh.live.test.ts
git commit -m "feat(sources): Deccan Herald Bengaluru adapter (Quintype section API)"
```

---

### Task 12: Goemkarponn adapter (Goa, WordPress crime category)

**Files:**
- Create: `src/sources/goemkarponn.ts`
- Test: `tests/sources/goemkarponn.test.ts`, `tests/sources/goemkarponn.live.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `Candidate`, `Article` (types); `htmlToText` (`src/sources/parse-article.ts`).
- Produces: `goemkarponn: SourceAdapter` with `id: 'goemkarponn'`, `name: 'Goemkarponn'`, `cities: ['goa']`. `discover` returns candidates with `article` pre-filled (no per-article fetch needed); `fetchArticle` returns `c.article ?? null`.

Endpoint (from `research/sources/goa_regional.md`): WordPress REST `…/wp-json/wp/v2/posts?categories=255&after=…&before=…&per_page=100&page=N` with `X-WP-TotalPages` header.

- [ ] **Step 1: Verify host and category**

Run:

```bash
curl -sI -A "Mozilla/5.0" "https://www.goemkarponn.com/wp-json/wp/v2/posts?categories=255&per_page=1" | grep -i -E "^HTTP|x-wp-total|location"
```

Expected: `HTTP/2 200` and `x-wp-total`/`x-wp-totalpages` headers. If it redirects to the bare domain, set `BASE` below to the redirect target.

- [ ] **Step 2: Write failing tests** — `tests/sources/goemkarponn.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { goemkarponn } from '../../src/sources/goemkarponn.js';
import type { Http, HttpResponse } from '../../src/types.js';

const post = (id: number) => ({
  id, date_gmt: '2026-09-20T05:30:00', link: `https://www.goemkarponn.com/story-${id}/`,
  title: { rendered: `Theft at Colva &#8211; case ${id}` },
  excerpt: { rendered: '<p>Colva police registered a case.</p>' },
  content: { rendered: '<p>On Friday, Colva police registered a case.</p><p>More.</p>' },
});

describe('goemkarponn adapter', () => {
  it('pages the crime category and returns pre-parsed articles', async () => {
    const urls: string[] = [];
    const http: Http = {
      async get(url): Promise<HttpResponse> {
        urls.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        return { status: 200, body: JSON.stringify(page === 1 ? [post(1), post(2)] : [post(3)]), format: 'json', via: 'direct', headers: { 'x-wp-totalpages': '2' } };
      },
    };
    const got = await goemkarponn.discover({ mode: 'live', since: new Date('2026-09-19T00:00:00Z'), until: new Date('2026-09-26T00:00:00Z') }, http);
    expect(got).toHaveLength(3);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('categories')).toBe('255');
    expect(q.get('after')).toBe('2026-09-19T00:00:00');
    expect(got[0].article).toEqual({
      url: 'https://www.goemkarponn.com/story-1/', title: 'Theft at Colva – case 1',
      publishedAt: new Date('2026-09-20T05:30:00Z'), description: 'Colva police registered a case.',
      text: 'On Friday, Colva police registered a case.\nMore.', keywords: [], city: 'goa', sourceName: 'Goemkarponn',
    });
    expect(await goemkarponn.fetchArticle(got[0], http)).toBe(got[0].article);
  });

  it('stops on an HTTP 400 past the last page', async () => {
    const http: Http = { get: async () => ({ status: 400, body: '{}', format: 'json', via: 'direct', headers: {} }) };
    expect(await goemkarponn.discover({ mode: 'live', since: new Date(0), until: new Date() }, http)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/sources/goemkarponn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `src/sources/goemkarponn.ts`

```ts
import type { Candidate, SourceAdapter } from '../types.js';
import { htmlToText } from './parse-article.js';

const BASE = 'https://www.goemkarponn.com';
const CRIME_CATEGORY = '255';
const MAX_PAGES = 40;

interface WpPost {
  id: number;
  date_gmt: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
}

const wpDate = (d: Date) => d.toISOString().slice(0, 19);

export const goemkarponn: SourceAdapter = {
  id: 'goemkarponn',
  name: 'Goemkarponn',
  cities: ['goa'],

  async discover({ since, until }, http) {
    const out: Candidate[] = [];
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const u = new URL(`${BASE}/wp-json/wp/v2/posts`);
      u.search = new URLSearchParams({
        categories: CRIME_CATEGORY, after: wpDate(since), before: wpDate(until), per_page: '100', page: String(page),
        _fields: 'id,date_gmt,link,title,excerpt,content',
      }).toString();
      const res = await http.get(u.toString(), { accept: 'json' });
      if (res.status !== 200) break;
      totalPages = Number(res.headers['x-wp-totalpages'] ?? 1);
      for (const p of JSON.parse(res.body) as WpPost[]) {
        const publishedAt = new Date(`${p.date_gmt}Z`);
        const title = htmlToText(p.title.rendered);
        out.push({
          url: p.link, title, publishedAt, city: 'goa',
          article: {
            url: p.link, title, publishedAt, description: htmlToText(p.excerpt.rendered) || null,
            text: htmlToText(p.content.rendered), keywords: [], city: 'goa', sourceName: this.name,
          },
        });
      }
    }
    return out;
  },

  async fetchArticle(c) {
    return c.article ?? null;
  },
};
```

- [ ] **Step 5: Run tests, then the live smoke test**

`tests/sources/goemkarponn.live.test.ts`:

```ts
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
```

Run: `npx vitest run tests/sources/goemkarponn.test.ts && LIVE=1 npx vitest run tests/sources/goemkarponn.live.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/goemkarponn.ts tests/sources/goemkarponn.test.ts tests/sources/goemkarponn.live.test.ts
git commit -m "feat(sources): Goemkarponn Goa adapter (WordPress crime category)"
```

---

### Task 13: Read APIs — heatmap, reports, meta

**Files:**
- Create: `src/api/http.ts`, `src/api/params.ts`, `src/api/heatmap.ts`, `src/api/reports.ts`, `src/api/meta.ts`
- Create: `api/heatmap.ts`, `api/reports.ts`, `api/meta.ts`
- Test: `tests/api/params.test.ts`, `tests/api/heatmap.test.ts`, `tests/api/reports.test.ts`

**Interfaces:**
- Consumes: `Db`, `City`, `CategoryId`, `CATEGORY_IDS`, `SOURCE_TYPES` (types); `CITY_CONFIG`, `isCity` (config); `CATEGORY_DEFS`, `CATEGORY_BY_ID` (Task 4); `createTestDb`, `upsertReport` (Task 2).
- Produces:
  - `json(data: unknown, status?: number, cache?: boolean): Response`, `badRequest(msg: string): Response`, `preflight(): Response` (`src/api/http.ts`)
  - `parseCommon(q: URLSearchParams, today?: Date): CommonParams | { error: string }` where `CommonParams = { city: City; from: string; to: string; start: Date; end: Date; layer: 'safety'|'fraud'|'all'; categories: CategoryId[]; sources: string[] }`
  - `binPoints(points: { lat: number; lng: number; weight: number }[], cell: number): { lat: number; lng: number; count: number; weight: number }[]`
  - `handleHeatmap(req: Request, db: Db): Promise<Response>`, `handleReports(req: Request, db: Db): Promise<Response>`, `handleMeta(req: Request, db: Db): Promise<Response>`

API contract (for the frontend):
- `from`/`to` default to the full 6-month window ending today (IST).
- `GET /api/heatmap?city=delhi&layer=safety|fraud|all&from=YYYY-MM-DD&to=YYYY-MM-DD&cell=0.01&categories=a,b&sources=news,police` → `{ city, layer, from, to, cell, total, max_weight, cells: [{ lat, lng, count, weight }] }`
- `GET /api/reports?city=…&from&to&layer&categories&sources&bbox=minLng,minLat,maxLng,maxLat&limit=50&before_id=123` → `{ reports: [...], next_before_id }`
- `GET /api/meta` → `{ cities: [{ id, name, center, bbox }], categories: [{ id, label, layer, weight }], sources: [{ city, source_name, source_type, count, first, last }] }`

- [ ] **Step 1: Write failing tests**

`tests/api/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCommon } from '../../src/api/params.js';

const q = (s: string) => new URLSearchParams(s);
const today = new Date('2026-09-26T06:00:00Z');

describe('parseCommon', () => {
  it('requires a valid city', () => {
    expect(parseCommon(q(''), today)).toEqual({ error: 'city must be one of delhi, bengaluru, goa' });
    expect(parseCommon(q('city=mumbai'), today)).toHaveProperty('error');
  });
  it('builds IST day boundaries', () => {
    const p = parseCommon(q('city=delhi&from=2026-09-26&to=2026-09-26'), today);
    if ('error' in p) throw new Error(p.error);
    expect(p.start.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    expect(p.end.toISOString()).toBe('2026-09-26T18:30:00.000Z');
  });
  it('defaults to the full 6-month window in IST and all layers', () => {
    const p = parseCommon(q('city=goa'), today);
    if ('error' in p) throw new Error(p.error);
    expect([p.from, p.to, p.layer]).toEqual(['2026-03-26', '2026-09-26', 'all']);
    expect(p.sources).toEqual(['news', 'police', 'review']);
  });
  it('filters categories by layer or explicit list', () => {
    const f = parseCommon(q('city=goa&layer=fraud'), today);
    if ('error' in f) throw new Error(f.error);
    expect(f.categories.sort()).toEqual(['cyber_fraud', 'fraud']);
    const e = parseCommon(q('city=goa&categories=murder,bogus'), today);
    if ('error' in e) throw new Error(e.error);
    expect(e.categories).toEqual(['murder']);
  });
  it('rejects malformed dates and inverted ranges', () => {
    expect(parseCommon(q('city=goa&from=26-09-2026'), today)).toHaveProperty('error');
    expect(parseCommon(q('city=goa&from=2026-09-26&to=2026-09-01'), today)).toHaveProperty('error');
  });
});
```

`tests/api/heatmap.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { binPoints, handleHeatmap } from '../../src/api/heatmap.js';
import { upsertReport } from '../../src/db/reports-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import type { Db, ReportRow } from '../../src/types.js';

let n = 0;
function row(over: Partial<ReportRow>): ReportRow {
  n++;
  return {
    source_type: 'news', source_name: 'TOI', source_link: `https://x/${n}`, title: `t${n}`, category: 'robbery',
    description: null, incident_at: null, incident_precision: 'unknown',
    published_at: new Date('2026-09-20T10:00:00+05:30'), city: 'delhi', location_text: 'X',
    lat: 28.6015, lng: 77.2015, geo_precision: 'locality', dedup_group_id: null, ...over,
  };
}
const get = (db: Db, qs: string) => handleHeatmap(new Request(`https://app/api/heatmap?${qs}`), db).then(async (r) => ({ status: r.status, body: await r.json() }));

describe('binPoints', () => {
  it('bins into cell centres and sums weights', () => {
    expect(binPoints([{ lat: 28.6015, lng: 77.2015, weight: 4 }, { lat: 28.6049, lng: 77.2001, weight: 1 }, { lat: 28.623, lng: 77.203, weight: 2 }], 0.01))
      .toEqual([{ lat: 28.605, lng: 77.205, count: 2, weight: 5 }, { lat: 28.625, lng: 77.205, count: 1, weight: 2 }]);
  });
});

describe('GET /api/heatmap', () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });

  it('never plots city-precision rows', async () => {
    await upsertReport(db, row({ geo_precision: 'city', lat: 28.6139, lng: 77.209 }));
    await upsertReport(db, row({}));
    const { body } = await get(db, 'city=delhi&from=2026-09-01&to=2026-09-30');
    expect(body.total).toBe(1);
    expect(body.cells).toHaveLength(1);
  });

  it('respects IST day boundaries', async () => {
    await upsertReport(db, row({ published_at: new Date('2026-09-26T00:30:00+05:30') }));
    await upsertReport(db, row({ published_at: new Date('2026-09-25T23:30:00+05:30') }));
    const { body } = await get(db, 'city=delhi&from=2026-09-26&to=2026-09-26');
    expect(body.total).toBe(1);
  });

  it('uses incident time when known', async () => {
    await upsertReport(db, row({ incident_at: new Date('2026-08-01T10:00:00+05:30'), incident_precision: 'date' }));
    expect((await get(db, 'city=delhi&from=2026-09-01&to=2026-09-30')).body.total).toBe(0);
    expect((await get(db, 'city=delhi&from=2026-08-01&to=2026-08-01')).body.total).toBe(1);
  });

  it('counts a dedup group once and filters by layer', async () => {
    const a = await upsertReport(db, row({}));
    await upsertReport(db, row({ dedup_group_id: a.id }));
    await upsertReport(db, row({ category: 'cyber_fraud' }));
    expect((await get(db, 'city=delhi&from=2026-09-01&to=2026-09-30&layer=safety')).body.total).toBe(1);
    const fraud = await get(db, 'city=delhi&from=2026-09-01&to=2026-09-30&layer=fraud');
    expect(fraud.body).toMatchObject({ total: 1, max_weight: 3 });
  });

  it('rejects bad params', async () => {
    expect((await get(db, 'city=paris')).status).toBe(400);
    expect((await get(db, 'city=delhi&cell=5')).status).toBe(400);
  });
});
```

`tests/api/reports.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { handleReports } from '../../src/api/reports.js';
import { handleMeta } from '../../src/api/meta.js';
import { upsertReport } from '../../src/db/reports-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import type { Db, ReportRow } from '../../src/types.js';

function row(i: number, over: Partial<ReportRow> = {}): ReportRow {
  return {
    source_type: 'news', source_name: 'TOI', source_link: `https://x/${i}`, title: `t${i}`, category: 'robbery',
    description: 'd', incident_at: null, incident_precision: 'unknown', published_at: new Date('2026-09-20T10:00:00+05:30'),
    city: 'delhi', location_text: 'X', lat: 28.6, lng: 77.2, geo_precision: 'locality', dedup_group_id: null, ...over,
  };
}

describe('GET /api/reports and /api/meta', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    for (let i = 1; i <= 3; i++) await upsertReport(db, row(i));
    await upsertReport(db, row(4, { lat: 28.8, lng: 77.0 }));
  });

  it('paginates newest first with before_id', async () => {
    const r1 = await (await handleReports(new Request('https://app/api/reports?city=delhi&from=2026-09-01&to=2026-09-30&limit=2'), db)).json();
    expect(r1.reports.map((r: { title: string }) => r.title)).toEqual(['t4', 't3']);
    const r2 = await (await handleReports(new Request(`https://app/api/reports?city=delhi&from=2026-09-01&to=2026-09-30&limit=2&before_id=${r1.next_before_id}`), db)).json();
    expect(r2.reports.map((r: { title: string }) => r.title)).toEqual(['t2', 't1']);
  });

  it('filters by bbox', async () => {
    const r = await (await handleReports(new Request('https://app/api/reports?city=delhi&from=2026-09-01&to=2026-09-30&bbox=77.1,28.5,77.3,28.7'), db)).json();
    expect(r.reports).toHaveLength(3);
    expect((await handleReports(new Request('https://app/api/reports?city=delhi&bbox=1,2,3'), db)).status).toBe(400);
  });

  it('returns meta with cities, categories and per-source counts', async () => {
    const m = await (await handleMeta(new Request('https://app/api/meta'), db)).json();
    expect(m.cities.map((c: { id: string }) => c.id)).toEqual(['delhi', 'bengaluru', 'goa']);
    expect(m.categories.find((c: { id: string }) => c.id === 'cyber_fraud').layer).toBe('fraud');
    expect(m.sources).toEqual([expect.objectContaining({ city: 'delhi', source_name: 'TOI', count: 4 })]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `src/api/http.ts`

```ts
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

export function json(data: unknown, status = 200, cache = true): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache && status === 200 ? 's-maxage=300, stale-while-revalidate=600' : 'no-store',
      ...CORS,
    },
  });
}

export const badRequest = (msg: string) => json({ error: msg }, 400, false);
export const preflight = () => new Response(null, { status: 204, headers: CORS });
```

`src/api/params.ts`:

```ts
import { isCity } from '../config/cities.js';
import { WINDOW_DAYS } from '../config/window.js';
import { CATEGORY_DEFS } from '../extract/category.js';
import { CATEGORY_IDS, SOURCE_TYPES, type CategoryId, type City } from '../types.js';

export interface CommonParams {
  city: City; from: string; to: string; start: Date; end: Date;
  layer: 'safety' | 'fraud' | 'all'; categories: CategoryId[]; sources: string[];
}

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const istStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

export function parseCommon(q: URLSearchParams, today = new Date()): CommonParams | { error: string } {
  const city = q.get('city');
  if (!isCity(city)) return { error: 'city must be one of delhi, bengaluru, goa' };
  const to = q.get('to') ?? istDay(today);
  const from = q.get('from') ?? istDay(new Date(istStart(to).getTime() - WINDOW_DAYS * DAY_MS));
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(istStart(from).getTime()) || Number.isNaN(istStart(to).getTime())) {
    return { error: 'from/to must be YYYY-MM-DD' };
  }
  const start = istStart(from);
  const end = new Date(istStart(to).getTime() + DAY_MS);
  if (start >= end) return { error: 'from must be on or before to' };
  const layerParam = q.get('layer') ?? 'all';
  if (!['safety', 'fraud', 'all'].includes(layerParam)) return { error: 'layer must be safety, fraud or all' };
  const layer = layerParam as CommonParams['layer'];
  const explicit = q.get('categories')?.split(',').map((s) => s.trim())
    .filter((s): s is CategoryId => (CATEGORY_IDS as readonly string[]).includes(s));
  const categories = explicit?.length ? explicit
    : CATEGORY_DEFS.filter((d) => layer === 'all' || d.layer === layer).map((d) => d.id);
  const sources = (q.get('sources')?.split(',') ?? [...SOURCE_TYPES])
    .filter((s) => (SOURCE_TYPES as readonly string[]).includes(s));
  if (!sources.length) return { error: 'sources must include news, police or review' };
  return { city, from, to, start, end, layer, categories, sources };
}
```

`src/api/heatmap.ts`:

```ts
import { CATEGORY_BY_ID } from '../extract/category.js';
import type { CategoryId, Db } from '../types.js';
import { badRequest, json } from './http.js';
import { parseCommon } from './params.js';

const SQL = `
  select distinct on (coalesce(dedup_group_id, id)) lat, lng, category
  from reports
  where city = $1
    and geo_precision in ('exact', 'police_station', 'locality')
    and lat is not null and lng is not null
    and coalesce(incident_at, published_at) >= $2::timestamptz
    and coalesce(incident_at, published_at) < $3::timestamptz
    and category in (select jsonb_array_elements_text($4::jsonb))
    and source_type in (select jsonb_array_elements_text($5::jsonb))
  order by coalesce(dedup_group_id, id), id
  limit 50000`;

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function binPoints(points: { lat: number; lng: number; weight: number }[], cell: number) {
  const bins = new Map<string, { lat: number; lng: number; count: number; weight: number }>();
  for (const p of points) {
    const i = Math.floor(p.lat / cell);
    const j = Math.floor(p.lng / cell);
    const key = `${i}:${j}`;
    const b = bins.get(key) ?? { lat: r6((i + 0.5) * cell), lng: r6((j + 0.5) * cell), count: 0, weight: 0 };
    b.count++;
    b.weight += p.weight;
    bins.set(key, b);
  }
  return [...bins.values()];
}

export async function handleHeatmap(req: Request, db: Db): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const p = parseCommon(q);
  if ('error' in p) return badRequest(p.error);
  const cell = q.has('cell') ? Number(q.get('cell')) : 0.01;
  if (!(cell >= 0.002 && cell <= 0.1)) return badRequest('cell must be between 0.002 and 0.1 degrees');
  const rows = await db.query<{ lat: number; lng: number; category: CategoryId }>(SQL, [
    p.city, p.start.toISOString(), p.end.toISOString(), JSON.stringify(p.categories), JSON.stringify(p.sources),
  ]);
  const cells = binPoints(rows.map((r) => ({ lat: r.lat, lng: r.lng, weight: CATEGORY_BY_ID[r.category]?.weight ?? 1 })), cell);
  return json({
    city: p.city, layer: p.layer, from: p.from, to: p.to, cell, total: rows.length,
    max_weight: cells.reduce((m, c) => Math.max(m, c.weight), 0), cells,
  });
}
```

`src/api/reports.ts`:

```ts
import type { Db } from '../types.js';
import { badRequest, json } from './http.js';
import { parseCommon } from './params.js';

export async function handleReports(req: Request, db: Db): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const p = parseCommon(q);
  if ('error' in p) return badRequest(p.error);
  const limit = Math.min(Math.max(Number(q.get('limit') ?? 50) || 50, 1), 200);
  const params: unknown[] = [p.city, p.start.toISOString(), p.end.toISOString(), JSON.stringify(p.categories), JSON.stringify(p.sources)];
  const where = [
    'city = $1',
    'coalesce(incident_at, published_at) >= $2::timestamptz',
    'coalesce(incident_at, published_at) < $3::timestamptz',
    'category in (select jsonb_array_elements_text($4::jsonb))',
    'source_type in (select jsonb_array_elements_text($5::jsonb))',
  ];
  const bbox = q.get('bbox');
  if (bbox) {
    const b = bbox.split(',').map(Number);
    if (b.length !== 4 || b.some((x) => Number.isNaN(x))) return badRequest('bbox must be minLng,minLat,maxLng,maxLat');
    params.push(b[0], b[1], b[2], b[3]);
    const n = params.length;
    where.push(`lng >= $${n - 3} and lat >= $${n - 2} and lng <= $${n - 1} and lat <= $${n}`);
  }
  const before = Number(q.get('before_id'));
  if (q.has('before_id') && Number.isInteger(before)) {
    params.push(before);
    where.push(`id < $${params.length}`);
  }
  params.push(limit);
  const rows = await db.query<{ id: number }>(
    `select id::int as id, source_type, source_name, source_link, title, category, description,
       incident_at, incident_precision, published_at, city, location_text, lat, lng, geo_precision,
       dedup_group_id::int as dedup_group_id
     from reports where ${where.join(' and ')} order by id desc limit $${params.length}`,
    params,
  );
  return json({ reports: rows, next_before_id: rows.length === limit ? rows[rows.length - 1].id : null });
}
```

`src/api/meta.ts`:

```ts
import { CITY_CONFIG } from '../config/cities.js';
import { CATEGORY_DEFS } from '../extract/category.js';
import type { Db } from '../types.js';
import { json } from './http.js';

export async function handleMeta(_req: Request, db: Db): Promise<Response> {
  const sources = await db.query(
    `select city, source_name, source_type, count(*)::int as count, min(published_at) as first, max(published_at) as last
     from reports group by city, source_name, source_type order by city, source_name`);
  return json({
    cities: Object.entries(CITY_CONFIG).map(([id, c]) => ({ id, name: c.displayName, center: c.center, bbox: c.bbox })),
    categories: CATEGORY_DEFS.map(({ id, label, layer, weight }) => ({ id, label, layer, weight })),
    sources,
  });
}
```

Vercel routes — `api/heatmap.ts`:

```ts
import { handleHeatmap } from '../src/api/heatmap.js';
import { preflight } from '../src/api/http.js';
import { getDb } from '../src/db/client.js';

export function GET(req: Request) { return handleHeatmap(req, getDb()); }
export function OPTIONS() { return preflight(); }
```

`api/reports.ts`:

```ts
import { preflight } from '../src/api/http.js';
import { handleReports } from '../src/api/reports.js';
import { getDb } from '../src/db/client.js';

export function GET(req: Request) { return handleReports(req, getDb()); }
export function OPTIONS() { return preflight(); }
```

`api/meta.ts`:

```ts
import { preflight } from '../src/api/http.js';
import { handleMeta } from '../src/api/meta.js';
import { getDb } from '../src/db/client.js';

export function GET(req: Request) { return handleMeta(req, getDb()); }
export function OPTIONS() { return preflight(); }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api api tests/api
git commit -m "feat(api): heatmap, reports and meta endpoints with IST date filters"
```

---

### Task 14: Pipeline — enrich, runIngest, default deps, backfill CLI

**Files:**
- Create: `src/pipeline/enrich.ts`, `src/pipeline/run.ts`, `src/pipeline/deps.ts`, `src/sources/index.ts`, `scripts/backfill.ts`
- Test: `tests/pipeline/enrich.test.ts`, `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: Tasks 2–12 exports: `upsertReport`, `existingLinks`, `recentForDedup`, `recordRun`, `createDbGeoCache`, `createHttp`, `canonicalUrl`, `classify`, `prefilter`, `extractIncidentTime`, `buildMatcher`, `matchLocation`, `GAZETTEER`, `createNominatim`, `resolveLocation`, `findDuplicate`, adapters `toi`, `ht`, `dh`, `goemkarponn`.
- Produces:
  - `interface EnrichDeps { resolve(i: LocationInput): Promise<ResolvedLocation>; recentForDedup(city: City, at: Date): Promise<DedupCandidate[]> }`
  - `enrichArticle(a: Article, deps: EnrichDeps): Promise<ReportRow | null>` (null = out of area)
  - `enrichInput(r: ReportInput, deps: EnrichDeps): Promise<ReportRow | null>`
  - `runIngest(opts: IngestOptions, deps: IngestDeps): Promise<IngestStats[]>` with `IngestOptions = { mode: 'live'|'backfill'; since: Date; until: Date; maxArticlesPerSource: number; deadline: number; sources?: string[] }`, `IngestStats = { source: string; discovered: number; candidates: number; skippedExisting: number; fetched: number; inserted: number; updated: number; outOfArea: number; outOfWindow: number; failed: number; errors: string[] }` (`since` is clamped to `windowStart(now())`; candidates/articles published before it count as `outOfWindow`), `IngestDeps = { db: Db; http: Http; adapters: SourceAdapter[]; enrich: EnrichDeps; now?: () => number; log?: (m: string) => void }`
  - `createDefaultDeps(db: Db): { http: Http; enrich: EnrichDeps }` (`src/pipeline/deps.ts`)
  - `ADAPTERS: SourceAdapter[]` (`src/sources/index.ts`)

- [ ] **Step 1: Write failing tests**

`tests/pipeline/enrich.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { enrichArticle, enrichInput, type EnrichDeps } from '../../src/pipeline/enrich.js';
import type { Article } from '../../src/types.js';

const inArea: EnrichDeps = {
  resolve: async () => ({ location_text: 'Shahdara', lat: 28.673, lng: 77.289, geo_precision: 'locality', in_area: true }),
  recentForDedup: async () => [],
};
const article: Article = {
  url: 'http://timesofindia.indiatimes.com/city/delhi/x/articleshow/1.cms?from=rss', title: 'Man robbed at knifepoint in Shahdara',
  publishedAt: new Date('2026-09-24T09:00:00+05:30'), description: 'x'.repeat(800),
  text: 'Around 11.30pm on Tuesday, a man was robbed.', keywords: ['Shahdara'], city: 'delhi', sourceName: 'Times of India',
};

describe('enrich', () => {
  it('builds a full row from an article', async () => {
    const r = (await enrichArticle(article, inArea))!;
    expect(r).toMatchObject({
      source_type: 'news', source_name: 'Times of India', category: 'robbery', city: 'delhi',
      source_link: 'https://timesofindia.indiatimes.com/city/delhi/x/articleshow/1.cms',
      incident_precision: 'datetime', location_text: 'Shahdara', geo_precision: 'locality', dedup_group_id: null,
    });
    expect(r.incident_at?.toISOString()).toBe('2026-09-22T18:00:00.000Z');
    expect(r.description).toHaveLength(500);
  });

  it('returns null for out-of-area locations', async () => {
    const out: EnrichDeps = { ...inArea, resolve: async () => ({ location_text: 'Nelamangala', lat: 13.09, lng: 77.39, geo_precision: 'locality', in_area: false }) };
    expect(await enrichArticle(article, out)).toBeNull();
  });

  it('links duplicates to the existing group', async () => {
    const dup: EnrichDeps = { ...inArea, recentForDedup: async () => [
      { id: 9, title: 'Man robbed at knifepoint in Shahdara', published_at: new Date('2026-09-24T05:00:00Z'), category: 'robbery', dedup_group_id: 4 }] };
    expect((await enrichArticle(article, dup))?.dedup_group_id).toBe(4);
  });

  it('enriches external police records, classifying their category text', async () => {
    const r = (await enrichInput({
      source_type: 'police', source_name: 'Delhi Police', source_link: 'https://delhipolice.gov.in/pr/1',
      title: 'Press release', category: 'Snatching', published_at: '2026-09-20T12:00:00+05:30',
      incident_at: '2026-09-18T21:00:00+05:30', city: 'delhi', location_text: 'Shahdara PS',
    }, inArea))!;
    expect(r).toMatchObject({ source_type: 'police', category: 'robbery', incident_precision: 'datetime', description: null });
    expect(r.published_at.toISOString()).toBe('2026-09-20T06:30:00.000Z');
  });
});
```

`tests/pipeline/run.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { runIngest } from '../../src/pipeline/run.js';
import type { EnrichDeps } from '../../src/pipeline/enrich.js';
import { createTestDb } from '../helpers/test-db.js';
import { fakeHttp } from '../helpers/fake-http.js';
import type { Article, Candidate, Db, SourceAdapter } from '../../src/types.js';

const pub = new Date('2026-09-25T10:00:00+05:30');
const art = (url: string, title: string): Article =>
  ({ url, title, publishedAt: pub, description: 'd', text: 'on Friday', keywords: [], city: 'delhi', sourceName: 'Fake' });

function adapter(cands: Candidate[]): SourceAdapter {
  return {
    id: 'fake', name: 'Fake', cities: ['delhi'],
    discover: async () => cands,
    fetchArticle: async (c) => (c.url.includes('broken') ? null : art(c.url, c.title)),
  };
}
const enrich = (inArea = (t: string) => !t.includes('Mysuru')): EnrichDeps => ({
  resolve: async (i) => ({ location_text: 'X', lat: 28.6, lng: 77.2, geo_precision: 'locality', in_area: inArea(i.title) }),
  recentForDedup: async () => [],
});

describe('runIngest', () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  const opts = { mode: 'live' as const, since: new Date(0), until: new Date(), maxArticlesPerSource: 10, deadline: Infinity };
  const NOW = Date.parse('2026-09-26T00:00:00Z');

  it('prefilters, fetches, enriches, stores and is idempotent on re-run', async () => {
    const cands: Candidate[] = [
      { url: 'https://n/1', title: 'Man robbed in Rohini', publishedAt: pub, city: 'delhi' },
      { url: 'https://n/1?utm=x', title: 'Man robbed in Rohini', publishedAt: pub, city: 'delhi' },
      { url: 'https://n/2', title: 'Delhi weather today', publishedAt: pub, city: 'delhi' },
      { url: 'https://n/3', title: 'Man stabbed near Mysuru', publishedAt: pub, city: 'delhi' },
      { url: 'https://n/broken', title: 'Woman robbed in Dwarka', publishedAt: pub, city: 'delhi' },
    ];
    const deps = { db, http: fakeHttp({}), adapters: [adapter(cands)], enrich: enrich(), now: () => NOW };
    const [s1] = await runIngest(opts, deps);
    expect(s1).toMatchObject({ discovered: 5, candidates: 3, skippedExisting: 0, fetched: 2, inserted: 1, outOfArea: 1, failed: 1 });
    const [s2] = await runIngest(opts, deps);
    expect(s2).toMatchObject({ skippedExisting: 1, inserted: 0 });
    const n = await db.query<{ n: number }>('select count(*)::int as n from reports');
    expect(n[0].n).toBe(1);
    const runs = await db.query<{ n: number }>('select count(*)::int as n from ingest_runs');
    expect(runs[0].n).toBe(2);
  });

  it('uses pre-fetched articles, honours the deadline and records discover errors', async () => {
    const pre = { url: 'https://n/9', title: 'Chain snatched in Saket', publishedAt: pub, city: 'delhi' as const, article: art('https://n/9', 'Chain snatched in Saket') };
    let t = 0;
    const [s] = await runIngest({ ...opts, deadline: 1 }, {
      db, http: fakeHttp({}), adapters: [adapter([pre, { ...pre, url: 'https://n/10' }])], enrich: enrich(), now: () => t++ });
    expect(s.inserted).toBe(1);
    expect(s.errors).toContain('deadline reached');
    const failing: SourceAdapter = { ...adapter([]), discover: async () => { throw new Error('boom'); } };
    const [f] = await runIngest(opts, { db, http: fakeHttp({}), adapters: [failing], enrich: enrich() });
    expect(f.errors).toEqual(['discover: boom']);
  });

  it('enforces the 6-month window on discovery and on stored articles', async () => {
    let seenSince: Date | undefined;
    const old = new Date('2026-01-15T10:00:00+05:30');
    const a: SourceAdapter = {
      ...adapter([]),
      discover: async (o) => {
        seenSince = o.since;
        return [
          { url: 'https://n/old', title: 'Man robbed in Rohini', publishedAt: old, city: 'delhi' },
          { url: 'https://n/undated', title: 'Man robbed in Saket', publishedAt: null, city: 'delhi' },
        ];
      },
      fetchArticle: async (c) => ({ ...art(c.url, c.title), publishedAt: old }),
    };
    const [s] = await runIngest({ ...opts, mode: 'backfill', since: new Date('2025-01-01T00:00:00Z') },
      { db, http: fakeHttp({}), adapters: [a], enrich: enrich(), now: () => NOW });
    expect(seenSince?.toISOString()).toBe('2026-03-26T00:00:00.000Z');
    expect(s).toMatchObject({ candidates: 1, outOfWindow: 2, inserted: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pipeline/enrich.test.ts tests/pipeline/run.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `src/pipeline/enrich.ts`

```ts
import { classify } from '../extract/category.js';
import { extractIncidentTime } from '../extract/incident-time.js';
import { canonicalUrl } from '../http/url.js';
import type { Article, City, DedupCandidate, IncidentTime, LocationInput, ReportInput, ReportRow, ResolvedLocation } from '../types.js';
import { findDuplicate } from './dedup.js';

export interface EnrichDeps {
  resolve(i: LocationInput): Promise<ResolvedLocation>;
  recentForDedup(city: City, at: Date): Promise<DedupCandidate[]>;
}

const truncate = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

async function finish(
  base: Omit<ReportRow, 'category' | 'incident_at' | 'incident_precision' | 'location_text' | 'lat' | 'lng' | 'geo_precision' | 'dedup_group_id'>,
  categoryText: string, incident: IncidentTime, loc: LocationInput, deps: EnrichDeps,
): Promise<ReportRow | null> {
  const where = await deps.resolve(loc);
  if (!where.in_area) return null;
  const category = classify(categoryText);
  const dup = findDuplicate({ title: base.title, publishedAt: base.published_at }, await deps.recentForDedup(base.city, base.published_at));
  return {
    ...base, category, incident_at: incident.incidentAt, incident_precision: incident.precision,
    location_text: where.location_text, lat: where.lat, lng: where.lng, geo_precision: where.geo_precision,
    dedup_group_id: dup ? dup.dedup_group_id ?? dup.id : null,
  };
}

export function enrichArticle(a: Article, deps: EnrichDeps): Promise<ReportRow | null> {
  return finish(
    {
      source_type: 'news', source_name: a.sourceName, source_link: canonicalUrl(a.url), title: a.title,
      description: truncate(a.description, 500), published_at: a.publishedAt, city: a.city,
    },
    `${a.title} ${a.description ?? ''}`,
    extractIncidentTime(a.text, a.publishedAt),
    { city: a.city, title: a.title, keywords: a.keywords, text: a.text },
    deps,
  );
}

export function enrichInput(r: ReportInput, deps: EnrichDeps): Promise<ReportRow | null> {
  const published = new Date(r.published_at);
  const incident: IncidentTime = r.incident_at
    ? { incidentAt: new Date(r.incident_at), precision: 'datetime' }
    : extractIncidentTime(r.description ?? '', published);
  return finish(
    {
      source_type: r.source_type, source_name: r.source_name, source_link: canonicalUrl(r.source_link), title: r.title,
      description: truncate(r.description, 500), published_at: published, city: r.city,
    },
    `${r.category ?? ''} ${r.title} ${r.description ?? ''}`,
    incident,
    { city: r.city, title: r.title, keywords: [], text: r.description ?? '', location_text: r.location_text, lat: r.lat, lng: r.lng },
    deps,
  );
}
```

Note: `canonicalUrl` strips query strings; police links that rely on query parameters to be unique must put the id in the path (documented in Task 15's contract).

`src/pipeline/run.ts`:

```ts
import { windowStart } from '../config/window.js';
import { existingLinks, recordRun, upsertReport } from '../db/reports-repo.js';
import { prefilter } from '../extract/category.js';
import { canonicalUrl } from '../http/url.js';
import type { Candidate, Db, Http, SourceAdapter } from '../types.js';
import { enrichArticle, type EnrichDeps } from './enrich.js';

export interface IngestOptions {
  mode: 'live' | 'backfill';
  since: Date;
  until: Date;
  maxArticlesPerSource: number;
  deadline: number;
  sources?: string[];
}
export interface IngestStats {
  source: string; discovered: number; candidates: number; skippedExisting: number; fetched: number;
  inserted: number; updated: number; outOfArea: number; outOfWindow: number; failed: number; errors: string[];
}
export interface IngestDeps {
  db: Db; http: Http; adapters: SourceAdapter[]; enrich: EnrichDeps; now?: () => number; log?: (m: string) => void;
}

const MAX_ERRORS = 20;

export async function runIngest(opts: IngestOptions, deps: IngestDeps): Promise<IngestStats[]> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const all: IngestStats[] = [];
  for (const adapter of deps.adapters.filter((a) => !opts.sources || opts.sources.includes(a.id))) {
    const s: IngestStats = { source: adapter.id, discovered: 0, candidates: 0, skippedExisting: 0, fetched: 0, inserted: 0, updated: 0, outOfArea: 0, outOfWindow: 0, failed: 0, errors: [] };
    const err = (m: string) => { if (s.errors.length < MAX_ERRORS) s.errors.push(m.slice(0, 300)); };
    all.push(s);
    const started = new Date();
    const cutoff = windowStart(now());
    const since = opts.since > cutoff ? opts.since : cutoff;
    try {
      const found = await adapter.discover({ mode: opts.mode, since, until: opts.until }, deps.http);
      s.discovered = found.length;
      const unique = new Map<string, Candidate>();
      for (const c of found) {
        if (c.publishedAt && c.publishedAt < cutoff) { s.outOfWindow++; continue; }
        let url: string;
        try { url = canonicalUrl(c.url); } catch { continue; }
        if (!unique.has(url) && prefilter({ title: c.title, url })) unique.set(url, { ...c, url });
      }
      s.candidates = unique.size;
      const existing = await existingLinks(deps.db, [...unique.keys()]);
      s.skippedExisting = existing.size;
      const todo = [...unique.values()].filter((c) => !existing.has(c.url))
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
        .slice(0, opts.maxArticlesPerSource);
      for (const c of todo) {
        if (now() > opts.deadline) { err('deadline reached'); break; }
        try {
          const article = c.article ?? (await adapter.fetchArticle(c, deps.http));
          if (!article) { s.failed++; continue; }
          s.fetched++;
          if (article.publishedAt < cutoff) { s.outOfWindow++; continue; }
          if (!prefilter({ title: article.title, url: c.url })) continue;
          const row = await enrichArticle({ ...article, url: c.url }, deps.enrich);
          if (!row) { s.outOfArea++; continue; }
          const r = await upsertReport(deps.db, row);
          if (r.inserted) s.inserted++; else s.updated++;
        } catch (e) {
          s.failed++;
          err(`${c.url}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      err(`discover: ${(e as Error).message}`);
    }
    await recordRun(deps.db, { source: adapter.id, mode: opts.mode, started_at: started, finished_at: new Date(), stats: s });
    log(`${adapter.id}: ${JSON.stringify(s)}`);
  }
  return all;
}
```

`src/sources/index.ts`:

```ts
import type { SourceAdapter } from '../types.js';
import { dh } from './dh.js';
import { goemkarponn } from './goemkarponn.js';
import { ht } from './ht.js';
import { toi } from './toi.js';

export const ADAPTERS: SourceAdapter[] = [toi, ht, dh, goemkarponn];
```

`src/pipeline/deps.ts`:

```ts
import { createDbGeoCache } from '../db/geo-cache.js';
import { recentForDedup } from '../db/reports-repo.js';
import { GAZETTEER } from '../geo/gazetteer-data/index.js';
import { buildMatcher, matchLocation, type Matcher } from '../geo/matcher.js';
import { createNominatim } from '../geo/nominatim.js';
import { resolveLocation } from '../geo/resolve.js';
import { createHttp } from '../http/client.js';
import { CITIES, type City, type Db, type Http } from '../types.js';
import type { EnrichDeps } from './enrich.js';

let matchers: Record<City, Matcher> | undefined;
function getMatchers(): Record<City, Matcher> {
  matchers ??= Object.fromEntries(CITIES.map((c) => [c, buildMatcher(GAZETTEER[c], c)])) as Record<City, Matcher>;
  return matchers;
}

export function createDefaultDeps(db: Db): { http: Http; enrich: EnrichDeps } {
  const { geocode } = createNominatim({ cache: createDbGeoCache(db) });
  const m = getMatchers();
  return {
    http: createHttp({ anakinKey: process.env.ANAKIN_API_KEY || undefined }),
    enrich: {
      resolve: (i) => resolveLocation(i, { match: (x) => matchLocation(m[x.city], x), geocode }),
      recentForDedup: (city, at) => recentForDedup(db, city, at),
    },
  };
}
```

`scripts/backfill.ts`:

```ts
import { parseArgs } from 'node:util';
import { createNeonDb } from '../src/db/client.js';
import { createDefaultDeps } from '../src/pipeline/deps.js';
import { runIngest } from '../src/pipeline/run.js';
import { ADAPTERS } from '../src/sources/index.js';

// Usage: npm run backfill -- --from 2026-03-26 --to 2026-09-26 [--source toi,ht] [--max 5000]
// runIngest clamps --from to the 6-month window.
const { values } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' }, source: { type: 'string' }, max: { type: 'string', default: '5000' } },
});
if (!values.from || !values.to) throw new Error('--from and --to (YYYY-MM-DD) are required');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const db = createNeonDb(url);
const deps = createDefaultDeps(db);
const stats = await runIngest(
  {
    mode: 'backfill',
    since: new Date(`${values.from}T00:00:00+05:30`),
    until: new Date(`${values.to}T23:59:59+05:30`),
    maxArticlesPerSource: Number(values.max),
    deadline: Infinity,
    sources: values.source?.split(','),
  },
  { db, ...deps, adapters: ADAPTERS, log: console.log },
);
console.table(stats.map(({ errors, ...s }) => ({ ...s, errors: errors.length })));
```

- [ ] **Step 4: Run tests and full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all non-live tests PASS; live tests reported as skipped.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline src/sources/index.ts scripts/backfill.ts tests/pipeline
git commit -m "feat(pipeline): enrich + idempotent runIngest with default deps and backfill CLI"
```

---

### Task 15: Ingest API (police records), cron endpoint, Vercel config, scheduler, contract doc

**Files:**
- Create: `src/api/ingest.ts`, `src/api/cron.ts`, `api/ingest.ts`, `api/cron/ingest.ts`, `vercel.json`, `.github/workflows/ingest.yml`, `docs/ingest-contract.md`
- Test: `tests/api/ingest.test.ts`, `tests/api/cron.test.ts`

**Interfaces:**
- Consumes: `enrichInput`, `EnrichDeps` (Task 14); `runIngest`, `IngestStats`; `createDefaultDeps`; `ADAPTERS`; `upsertReport`; `json`, `badRequest`, `preflight`; `CITIES`, `SOURCE_TYPES`.
- Produces:
  - `handleIngest(req: Request, deps: { db: Db; enrich: EnrichDeps; apiKey: string | undefined; now?: () => number }): Promise<Response>` → `{ inserted, updated, rejected: [{ index, error }] }`; records with `published_at` before `windowStart(now())` are rejected with `published_at outside the 6-month window`
  - `handleCron(req: Request, deps: { secret: string | undefined; run: () => Promise<IngestStats[]> }): Promise<Response>`

- [ ] **Step 1: Write failing tests**

`tests/api/ingest.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { handleIngest } from '../../src/api/ingest.js';
import type { EnrichDeps } from '../../src/pipeline/enrich.js';
import { createTestDb } from '../helpers/test-db.js';
import type { Db } from '../../src/types.js';

const enrich: EnrichDeps = {
  resolve: async (i) => i.location_text === 'Mysuru'
    ? { location_text: 'Mysuru', lat: 12.29, lng: 76.63, geo_precision: 'locality', in_area: false }
    : { location_text: 'Madiwala Police Station', lat: 12.92, lng: 77.62, geo_precision: 'police_station', in_area: true },
  recentForDedup: async () => [],
};
const rec = (over: Record<string, unknown> = {}) => ({
  source_type: 'police', source_name: 'Bengaluru City Police', source_link: 'https://example.gov.in/pr/1',
  title: 'Two held for chain snatching', category: 'Snatching', published_at: '2026-09-20T12:00:00+05:30',
  city: 'bengaluru', location_text: 'Madiwala PS', ...over,
});
const NOW = Date.parse('2026-09-26T00:00:00Z');
const post = (db: Db, body: unknown, auth = 'Bearer k') => handleIngest(
  new Request('https://app/api/ingest', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  { db, enrich, apiKey: 'k', now: () => NOW });

describe('POST /api/ingest', () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });

  it('rejects missing/wrong auth and unconfigured keys', async () => {
    expect((await post(db, { records: [rec()] }, '')).status).toBe(401);
    expect((await post(db, { records: [rec()] }, 'Bearer nope')).status).toBe(401);
    const r = await handleIngest(new Request('https://app/api/ingest', { method: 'POST', body: '{}' }), { db, enrich, apiKey: undefined });
    expect(r.status).toBe(503);
  });

  it('rejects malformed bodies', async () => {
    expect((await post(db, { nope: 1 })).status).toBe(400);
    const bad = await handleIngest(new Request('https://app/api/ingest', { method: 'POST', headers: { authorization: 'Bearer k' }, body: 'not json' }), { db, enrich, apiKey: 'k' });
    expect(bad.status).toBe(400);
  });

  it('stores valid records, reports per-record errors, and is idempotent', async () => {
    const body = { records: [rec(), rec({ city: 'mumbai' }), rec({ source_link: 'https://example.gov.in/pr/2', location_text: 'Mysuru' })] };
    const r1 = await (await post(db, body)).json();
    expect(r1.inserted).toBe(1);
    expect(r1.rejected.map((x: { index: number }) => x.index)).toEqual([1, 2]);
    expect(r1.rejected[1].error).toBe('location outside city area');
    const r2 = await (await post(db, { records: [rec()] })).json();
    expect(r2).toEqual({ inserted: 0, updated: 1, rejected: [] });
    const rows = await db.query<{ category: string; geo_precision: string }>('select category, geo_precision from reports');
    expect(rows).toEqual([{ category: 'robbery', geo_precision: 'police_station' }]);
  });

  it('rejects records older than the 6-month window', async () => {
    const r = await (await post(db, { records: [rec({ source_link: 'https://example.gov.in/pr/old', published_at: '2026-02-01T12:00:00+05:30' })] })).json();
    expect(r).toEqual({ inserted: 0, updated: 0, rejected: [{ index: 0, error: 'published_at outside the 6-month window' }] });
  });
});
```

`tests/api/cron.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleCron } from '../../src/api/cron.js';

describe('GET /api/cron/ingest', () => {
  it('requires the cron secret', async () => {
    const run = vi.fn(async () => []);
    expect((await handleCron(new Request('https://app/api/cron/ingest'), { secret: 's', run })).status).toBe(401);
    expect((await handleCron(new Request('https://app/api/cron/ingest'), { secret: undefined, run })).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it('runs ingestion and returns stats', async () => {
    const stats = [{ source: 'toi', discovered: 1, candidates: 1, skippedExisting: 0, fetched: 1, inserted: 1, updated: 0, outOfArea: 0, outOfWindow: 0, failed: 0, errors: [] }];
    const r = await handleCron(new Request('https://app/api/cron/ingest', { headers: { authorization: 'Bearer s' } }), { secret: 's', run: async () => stats });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, stats });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api/ingest.test.ts tests/api/cron.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `src/api/ingest.ts`

```ts
import { z } from 'zod';
import { windowStart } from '../config/window.js';
import { upsertReport } from '../db/reports-repo.js';
import { enrichInput, type EnrichDeps } from '../pipeline/enrich.js';
import { CITIES, SOURCE_TYPES, type Db, type ReportInput } from '../types.js';
import { badRequest, json } from './http.js';

const RecordSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  source_name: z.string().min(1).max(200),
  source_link: z.string().url().max(2000),
  title: z.string().min(1).max(500),
  category: z.string().max(100).nullish(),
  description: z.string().max(5000).nullish(),
  incident_at: z.string().datetime({ offset: true }).nullish(),
  published_at: z.string().datetime({ offset: true }),
  city: z.enum(CITIES),
  location_text: z.string().max(300).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});
const BodySchema = z.object({ records: z.array(z.unknown()).min(1).max(500) });

export async function handleIngest(
  req: Request,
  deps: { db: Db; enrich: EnrichDeps; apiKey: string | undefined; now?: () => number },
): Promise<Response> {
  const cutoff = windowStart((deps.now ?? Date.now)());
  if (!deps.apiKey) return json({ error: 'INGEST_API_KEY not configured' }, 503, false);
  if (req.headers.get('authorization') !== `Bearer ${deps.apiKey}`) return json({ error: 'unauthorized' }, 401, false);
  let raw: unknown;
  try { raw = await req.json(); } catch { return badRequest('body must be JSON'); }
  const body = BodySchema.safeParse(raw);
  if (!body.success) return badRequest('body must be { "records": [ ... ] } with 1-500 records');

  let inserted = 0;
  let updated = 0;
  const rejected: { index: number; error: string }[] = [];
  for (const [index, r] of body.data.records.entries()) {
    const parsed = RecordSchema.safeParse(r);
    if (!parsed.success) {
      rejected.push({ index, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    if (new Date(parsed.data.published_at) < cutoff) {
      rejected.push({ index, error: 'published_at outside the 6-month window' });
      continue;
    }
    try {
      const row = await enrichInput(parsed.data as ReportInput, deps.enrich);
      if (!row) { rejected.push({ index, error: 'location outside city area' }); continue; }
      const res = await upsertReport(deps.db, row);
      if (res.inserted) inserted++; else updated++;
    } catch (e) {
      rejected.push({ index, error: (e as Error).message });
    }
  }
  return json({ inserted, updated, rejected }, 200, false);
}
```

`src/api/cron.ts`:

```ts
import type { IngestStats } from '../pipeline/run.js';
import { json } from './http.js';

export async function handleCron(req: Request, deps: { secret: string | undefined; run: () => Promise<IngestStats[]> }): Promise<Response> {
  if (!deps.secret) return json({ error: 'CRON_SECRET not configured' }, 503, false);
  if (req.headers.get('authorization') !== `Bearer ${deps.secret}`) return json({ error: 'unauthorized' }, 401, false);
  const stats = await deps.run();
  return json({ ok: true, stats }, 200, false);
}
```

`api/ingest.ts`:

```ts
import { preflight } from '../src/api/http.js';
import { handleIngest } from '../src/api/ingest.js';
import { getDb } from '../src/db/client.js';
import { createDefaultDeps } from '../src/pipeline/deps.js';

export function POST(req: Request) {
  const db = getDb();
  return handleIngest(req, { db, enrich: createDefaultDeps(db).enrich, apiKey: process.env.INGEST_API_KEY });
}
export function OPTIONS() { return preflight(); }
```

`api/cron/ingest.ts`:

```ts
import { handleCron } from '../../src/api/cron.js';
import { getDb } from '../../src/db/client.js';
import { createDefaultDeps } from '../../src/pipeline/deps.js';
import { runIngest } from '../../src/pipeline/run.js';
import { ADAPTERS } from '../../src/sources/index.js';

export function GET(req: Request) {
  return handleCron(req, {
    secret: process.env.CRON_SECRET,
    run: () => {
      const db = getDb();
      const now = Date.now();
      return runIngest(
        { mode: 'live', since: new Date(now - 3 * 86_400_000), until: new Date(now), maxArticlesPerSource: 25, deadline: now + 240_000 },
        { db, ...createDefaultDeps(db), adapters: ADAPTERS, log: console.log },
      );
    },
  });
}
```

`vercel.json` (Hobby plan allows one cron run per day; the GitHub Action below adds 3-hourly runs):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/cron/ingest.ts": { "maxDuration": 300 },
    "api/ingest.ts": { "maxDuration": 120 }
  },
  "crons": [{ "path": "/api/cron/ingest", "schedule": "30 1 * * *" }]
}
```

`.github/workflows/ingest.yml`:

```yaml
name: ingest
on:
  schedule:
    - cron: '15 */3 * * *'
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger live ingestion
        run: >
          curl -fsS --max-time 310
          -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
          "${{ secrets.APP_URL }}/api/cron/ingest"
```

`docs/ingest-contract.md`:

````markdown
# Safe-it ingest contract (for the police-records pipeline)

`POST {APP_URL}/api/ingest` with header `Authorization: Bearer <INGEST_API_KEY>` and a JSON body
`{ "records": [ ... ] }` (1–500 records per call). Re-posting the same `source_link` updates the existing row, so retries are safe.

| field | required | notes |
|---|---|---|
| `source_type` | yes | `"police"` (or `"news"` / `"review"`) |
| `source_name` | yes | e.g. `"Delhi Police"`, `"Goa Police CCTNS"` |
| `source_link` | yes | Unique per record. Query strings are stripped, so put the record id in the path or fragment-free URL (e.g. `https://delhipolice.gov.in/newpressrelease/12345`). |
| `title` | yes | Short human-readable title. Never include personal names. |
| `category` | no | Free text (e.g. `"Snatching"`, `"Cheating"`); it's mapped to Safe-it's taxonomy together with the title. |
| `description` | no | ≤5000 chars accepted, stored truncated to 500. No personal names. |
| `incident_at` | no | ISO-8601 with offset, e.g. `2026-09-18T21:00:00+05:30`. |
| `published_at` | yes | ISO-8601 with offset. Must be within the last 6 months (184 days); older records are rejected. |
| `city` | yes | `delhi` \| `bengaluru` \| `goa` |
| `location_text` | no | Police station or locality, e.g. `"Hauz Khas PS"`; resolved via the gazetteer, then Nominatim. |
| `lat`, `lng` | no | If you have coordinates, send them; they take priority. |

Response: `{ "inserted": n, "updated": n, "rejected": [{ "index": i, "error": "..." }] }`. A record whose location resolves outside the city bounding box is rejected with `location outside city area`.

```bash
curl -X POST "$APP_URL/api/ingest" -H "Authorization: Bearer $INGEST_API_KEY" -H 'content-type: application/json' \
  -d '{"records":[{"source_type":"police","source_name":"Delhi Police","source_link":"https://delhipolice.gov.in/newpressrelease/12345","title":"Two held for snatching","category":"Snatching","published_at":"2026-09-20T12:00:00+05:30","city":"delhi","location_text":"Hauz Khas PS"}]}'
```
````

- [ ] **Step 4: Run tests and full suite**

Run: `npx vitest run && npm run typecheck`
Expected: all non-live tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/ingest.ts src/api/cron.ts api/ingest.ts api/cron vercel.json .github docs/ingest-contract.md tests/api/ingest.test.ts tests/api/cron.test.ts
git commit -m "feat(api): authenticated ingest endpoint, cron ingestion, Vercel + GitHub schedulers"
```

---

### Task 16: Deploy, migrate, backfill, smoke test

**Files:**
- Create: `README.md`
- Modify: none (operational task)

**Interfaces:**
- Consumes: everything above.
- Produces: a live deployment URL (`APP_URL`), a populated Neon database, `README.md` with run/deploy instructions.

- [ ] **Step 1: Create the Neon database and env**

In the Vercel dashboard: create/link the project for the `Safeit` repo → Storage → add **Neon** (Marketplace) → connect it to the project (sets `DATABASE_URL`). Then locally:

```bash
cd /Users/yash/MyProjects/Safe-it/safeit
npm i -g vercel
vercel link
vercel env pull .env
grep '^ANAKIN_API_KEY=' ../.env >> .env
echo "INGEST_API_KEY=$(openssl rand -hex 24)" >> .env
echo "CRON_SECRET=$(openssl rand -hex 24)" >> .env
```

Add `ANAKIN_API_KEY`, `INGEST_API_KEY` and `CRON_SECRET` to the Vercel project (Settings → Environment Variables, Production + Preview) with the same values. Do not print or commit `.env`.

- [ ] **Step 2: Migrate**

Run: `npm run migrate`
Expected: `migrated`. Re-running prints `migrated` again (idempotent).

- [ ] **Step 3: Pilot backfill (one week, all sources)**

Run: `npm run backfill -- --from 2026-09-19 --to 2026-09-26`
Expected: a table with one row per source. `inserted` > 0 for each of toi, ht, dh and goemkarponn; `failed` under ~10% of `fetched`. Inspect the data:

```bash
node --env-file=.env -e "
import('@neondatabase/serverless').then(async ({ neon }) => {
  const sql = neon(process.env.DATABASE_URL);
  console.table(await sql.query('select city, source_name, category, geo_precision, count(*)::int n from reports group by 1,2,3,4 order by 1,2,5 desc'));
});"
```

Expected: `geo_precision` `city` is under ~35% per city. If it's higher, extend `STOP_NAMES`/gazetteer or `extractPlacePhrase` and re-run the matcher tests before moving on.

- [ ] **Step 4: Full backfill (the locked 6-month window)**

Run: `npm run backfill -- --from 2026-03-26 --to 2026-09-26`
Expected: roughly 3,500–5,000 rows total, depending on prefilter precision. Research estimates for 6 months: TOI ~2,775 (Delhi ~1,550, Bengaluru ~850, Goa ~375), HT ~1,150, DH ~650, Goemkarponn ~1,050. Any `--from` earlier than the window is clamped automatically (`outOfWindow` in the stats). This takes a while because of the 1 req/s politeness and Nominatim throttling; run it in the background and re-run if interrupted, since already-stored links are skipped.

- [ ] **Step 5: Deploy and smoke test**

```bash
vercel deploy --prod
export APP_URL=https://<your-deployment>.vercel.app
curl -s "$APP_URL/api/meta" | head -c 600; echo
curl -s "$APP_URL/api/heatmap?city=bengaluru&layer=safety" | head -c 400; echo
curl -s "$APP_URL/api/reports?city=goa&limit=3" | head -c 600; echo
curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL/api/cron/ingest"
curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env | cut -d= -f2)" "$APP_URL/api/cron/ingest" | head -c 600; echo
```

Expected: meta lists 3 cities and 11 categories; heatmap returns non-empty `cells`; reports returns 3 items; unauthenticated cron returns `401`; authenticated cron returns `{"ok":true,"stats":[...]}` within 300 s.

Add GitHub repo secrets `CRON_SECRET` and `APP_URL`, then run the `ingest` workflow once via **Actions → ingest → Run workflow** and confirm it succeeds.

- [ ] **Step 6: Write `README.md`**

````markdown
# Safe-it backend

Crime/safety heatmap backend for Delhi, Bengaluru and Goa. Vercel Functions + Neon Postgres.

## Endpoints
- `GET /api/heatmap?city=delhi&layer=safety|fraud|all&from=YYYY-MM-DD&to=YYYY-MM-DD&cell=0.01`
- `GET /api/reports?city=…&from&to&layer&categories&sources&bbox=minLng,minLat,maxLng,maxLat&limit&before_id`
- `GET /api/meta`
- `POST /api/ingest` (Bearer `INGEST_API_KEY`) — see `docs/ingest-contract.md`
- `GET /api/cron/ingest` (Bearer `CRON_SECRET`) — live ingestion; daily Vercel cron + 3-hourly GitHub Action

## Local
```bash
npm i
cp .env.example .env   # fill in values
npm test               # unit tests (PGlite, no network)
LIVE=1 npx vitest run tests/sources   # live source smoke tests
npm run migrate
npm run backfill -- --from 2026-03-26 --to 2026-09-26 [--source toi,ht,dh,goemkarponn]   # 6-month window; older dates are clamped
npm run seed:gazetteer # regenerate OSM gazetteer (rarely needed)
```

## Sources
Times of India (Delhi, Bengaluru, Goa), Hindustan Times (Delhi), Deccan Herald (Bengaluru), Goemkarponn (Goa).
We store title, description (≤500 chars), link and derived fields only, never full article text.
Gazetteer © OpenStreetMap contributors (ODbL); geocoding by Nominatim.
````

- [ ] **Step 7: Commit and push**

```bash
git add README.md
git commit -m "docs: README with endpoints, local workflow and deploy notes"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** all eight user fields map to `reports` columns (title, category, source_name, source_link, incident_at + incident_precision, location_text + lat/lng, published_at, description). The final source choice gets T9–T12. Heatmap and fraud layer are covered by T4 and T13. Police integration is T15 (`/api/ingest` + contract doc). Vercel deploy is T15 and T16. Reviews are deferred, but `source_type: 'review'` is already accepted.
- **No-LLM decision:** category (T4), incident time (T5) and location (T6 + T7) are rule-based. The one seam for a future LLM is `EnrichDeps`/`enrichArticle`.
- **Known limitations (accepted for the hackathon):** out-of-area articles aren't remembered, so a live run may re-fetch them. Dedup is title-only within ±2 days. Deccan Herald's robots.txt blocks AI crawlers (our fetcher uses a browser UA and it's a human-built app, but a ToS check is still pending from the research).
````
