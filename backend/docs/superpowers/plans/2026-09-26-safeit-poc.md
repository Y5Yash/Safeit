# Safe-it Backend POC Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Code for most modules already exists in `2026-09-26-safeit-backend-full-reference.md` ("REF"); copy it and apply the deltas listed per task.

**Goal:** A working proof of concept. Collect a *sample* of crime/safety news (about 50–60 items per source-city, spread across the last 6 months) for Delhi, Bengaluru and Goa. Store it as a static JSON file and serve heatmap and report APIs from Vercel.

**Architecture:** There is no database, cron or ingest API.
- A local script (`npm run collect`) runs 4 source adapters, samples the candidates evenly over time, enriches them with rules (category, incident time, location, dedup) and writes `data/reports.json`.
- A second script merges the police-records session's `incidents.jsonl` into the same file.
- Vercel Functions (`api/*.ts`, Web `Request`→`Response`, no Next.js) read `data/reports.json` and serve `/api/heatmap` (H3 hexagons), `/api/reports` and `/api/meta`.

**Tech Stack:** Node 22, TypeScript strict ESM (NodeNext, `.js` import suffixes), Vitest, `fast-xml-parser`, `cheerio`, `h3-js`, `tsx`.

**Spec:** this file plus REF (source endpoints and code), `/Users/yash/MyProjects/Safe-it/merge_plan.md` (shared field names, police session), and `/Users/yash/MyProjects/Safe-it/research/sources/*.md`.

## Global Constraints
- Repo root is `/Users/yash/MyProjects/Safe-it/safeit`, a clone of `github.com/Y5Yash/Safeit`. All paths are relative to it.
- Cities: `delhi`, `bengaluru`, `goa`. All date parameters are in IST (`+05:30`).
- **6-month window:** `WINDOW_DAYS = 184`. Nothing published before `windowStart()` is collected or served.
- Sources: TOI (all 3 cities), HT (Delhi), Deccan Herald (Bengaluru), Goemkarponn (Goa).
- **Categories are provisional:** they live in the one file `src/config/categories.ts`, derived from the sample data. The user will replace them later, so nothing else may hard-code category ids. There are no "safety/fraud" layers.
- **No PII:** never store full article text. Run `scrubPii` over title, description and location_text. The description is at most 300 characters.
- Politeness: at least 1000 ms between requests to the same host, Anakin at most 20/min, Nominatim at most 1/s with UA `Safeit/0.1 (+https://github.com/Y5Yash/Safeit)`.
- Field names follow `merge_plan.md` §2, so the police session's rows merge without mapping.
- Subagents do **not** run git. The controller commits.

## Review Focus
1. Reports geocoded only to city level must never appear in the heatmap (test in T5).
2. IST day boundaries in `from`/`to` (test in T5).
3. A weekday that equals the publish weekday means the same day, using IST (tests in T3, copied from REF Task 5).
4. Re-running `collect` must not duplicate reports: it skips links already in `data/reports.json` (test in T8).
5. Out-of-area stories must be dropped, e.g. Nelamangala/Mysuru in DH (tests in T4 and T8).

## Waves
| Wave | Tasks (parallel) |
|---|---|
| 1 | **T1** scaffold + types + configs (controller) |
| 2 | **T2** http + parsing · **T3** extract (category, incident time, dedup, PII) · **T4** geo · **T5** API |
| 3 | **T6** TOI + HT adapters · **T7** DH + Goemkarponn adapters |
| 4 | **T8** collect + police merge scripts + vercel.json, then a real sample collection run |
| 5 | Final review, then commit |

---

### T1: Scaffold, shared types, configs (controller)
Files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, `src/config/cities.ts`, `src/config/window.ts`, `src/config/categories.ts`, tests for the configs.
- Copy REF Task 1, with these changes:
  - Drop the DB/ingest types.
  - Rename precisions to merge_plan names.
  - Add the `Report` record.
  - Deps: `cheerio fast-xml-parser h3-js`; dev deps: `typescript tsx vitest @types/node`.
- `src/config/categories.ts` exports `CATEGORIES: { id, label, re }[]` in priority order (below) and `classify(text): CategoryId`.

### T2: HTTP client, URL/XML helpers, article parsing
Copy REF Task 3 verbatim: `src/http/{client,url,xml}.ts`, `src/sources/parse-article.ts`, `tests/helpers/fake-http.ts`, and their tests.

### T3: Extractors
Files: `src/extract/{prefilter,incident-time,dedup,pii}.ts` and their tests.
- **prefilter:** copy `prefilter` from REF Task 4, but classify with `src/config/categories.ts` (`classify(...) !== 'other'` or an arrest word, and not excluded).
- **incident-time:** copy REF Task 5, renaming precision `'datetime'` to `'exact'`. Add a `date_range` case: "intervening night of 20/21" resolves to the first date, precision `date_range`.
- **dedup:** `assignEvents(reports: Report[]): Report[]`.
  - Use REF Task 8's `titleTokens`/Jaccard.
  - Group reports of the same city with `published_datetime` within ±2 days and Jaccard ≥ 0.5, *or* the same `police_station` + `category` + incident date.
  - `event_id` is the `id` of the earliest report in the group.
- **pii:** `scrubPii(s: string): string`. It removes:
  - `s/o …`, `d/o …`, `w/o …`, `r/o …` up to the next comma or full stop
  - `aged \d+`, `\d+-year-old`
  - house numbers `H\.? ?No\.? ?\S+`
  - It also collapses whitespace.

### T4: Geo
Files: `scripts/seed-gazetteer.ts`, `src/geo/{normalize,matcher,nominatim,resolve}.ts`, `src/geo/gazetteer-data/*`, `src/geo/file-cache.ts`, and tests.
- Copy REF Tasks 6 and 7 (run the seed).
- Delta 1: `createFileGeoCache(path)` is a JSON-file `GeoCache`, replacing the DB cache.
- Delta 2: `resolveLocation` also returns `police_station` (the station name when the match precision is `police_station`, else null).
- Delta 3: geo precision names are `address` (replaces `exact`), `police_station`, `locality`, `city`.

### T5: Read APIs
Files: `src/api/{http,params,heatmap,reports,meta,store}.ts`, `api/{heatmap,reports,meta}.ts`, and tests. Based on REF Task 13, with these deltas:
- **Store:** `loadReports()` reads `data/reports.json` (`process.cwd()`), is cached, and drops rows older than `windowStart()`. Handlers take `(req, reports: Report[])`.
- **Heatmap:**
  - Use one representative report per `event_id`: prefer a police source type, then the best geo precision.
  - Exclude `geo_precision = 'city'`.
  - Bin with `h3-js` `latLngToCell(lat, lng, res)` (`res` param, default 8, allowed 5–10).
  - Response: `{ city, from, to, res, total, max_count, cells: [{ h3, lat, lng, count, categories: {id: n} }] }`.
- **Params:** no `layer`. `categories=` is a comma list validated against `CATEGORIES`; `sources=news,police` (police matches every `police_*`). Defaults cover the full 6-month window.
- **Reports:** filters `city, from, to, categories, sources, h3 | bbox, limit (≤200), offset`. Newest first.
- **Meta:** returns cities, categories, per `city × source_name` counts, and the date range.

### T6 / T7: Adapters
Copy REF Tasks 9–10 (T6: `src/sources/toi.ts`, `src/sources/ht.ts`) and 11–12 (T7: `src/sources/dh.ts`, `src/sources/goemkarponn.ts`) with their unit and live tests. Apply REF's DH pagination fix: break on empty items or when `(page+1)*PAGE >= total`.

### T8: Collect, merge, deploy config
Files: `src/sources/index.ts`, `src/pipeline/enrich.ts`, `scripts/collect.ts`, `scripts/merge-police.ts`, `vercel.json`, `README.md`, and tests.
- **`enrichArticle(a, deps) → Report | null`.** Null means out of area.
  - category and `category_raw`: the first matching regex label.
  - `incident_datetime` via T3.
  - location via T4 resolve.
  - `scrubPii` on the text fields.
  - `id`: sha1 of the canonical link, first 12 hex characters.
- **`collect.ts`:** `npm run collect -- --per-source 55 [--source toi,ht] [--out data/reports.json]`.
  1. For each adapter, discover in backfill mode over the 6-month window.
  2. Prefilter, and drop links already in the output file.
  3. Pick N candidates per city, evenly spaced in time.
  4. Fetch and enrich them; run adapters concurrently (different hosts).
  5. Run `assignEvents` over all rows and write the file with pretty JSON.
- **`merge-police.ts`:** `npm run merge:police -- <path/to/incidents.jsonl>`.
  - Map merge_plan §2 rows to `Report`. Rows with `is_crime_incident === false` are skipped.
  - Upsert by `source_link`, then re-run `assignEvents`.
- **`vercel.json`:** `{"functions": {"api/*.ts": {"includeFiles": "data/**"}}}`.
- **Run:** do a real `npm run collect` and report per-source counts, the geo-precision distribution and the category distribution.

### Provisional categories (derived from the ~100 sample labels; priority order)
`sexual_crime` (sexual assault, rape, molestation, harassment, stalking, voyeurism, acid attack, POCSO) · `road_accident` (fatal, hit-and-run, drunk driving) · `murder` · `shooting` (firing, shot at) · `kidnapping` · `cyber_fraud` (digital arrest, investment/online scam) · `robbery` (armed robbery, dacoity, home invasion) · `snatching` (chain/phone snatching) · `assault` (attempt to murder, mob assault, domestic violence) · `extortion_organised_crime` (gang, extortion, arms) · `fraud` (cheating, forgery, financial fraud) · `drugs` (NDPS, narcotics, smuggling) · `burglary_theft` (theft, burglary, pickpocketing) · `drowning` · `unnatural_death` (suicide, found dead, unnatural death) · `public_safety` (building collapse, public nuisance, tourist incident) · `other`
