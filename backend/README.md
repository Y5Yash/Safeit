# Safe-it backend (POC)

A proof of concept for a crime and public-safety heatmap covering **Delhi, Bengaluru and Goa**.

- A local script collects a sample of crime news from the last 6 months: about 55 stories per source and city, spread evenly over time.
- It classifies each story, extracts the incident time, geocodes it and removes personal details.
- It writes the result to the static file `data/reports.json`.
- Vercel Functions serve that file as H3 heatmap cells and report lists.

There is no database, cron job or ingest API.

| Source | Cities |
|---|---|
| Times of India | Delhi, Bengaluru, Goa |
| Hindustan Times | Delhi |
| Deccan Herald | Bengaluru |
| Goemkarponn | Goa |

Police records from the separate police-records session can be merged into the same file (see below).

## Requirements

- Node 22+
- `npm install`
- Optional: `ANAKIN_API_KEY` in `.env`. It is used as a fallback fetcher when a site blocks direct requests.

```bash
npm test            # vitest (live network tests are skipped by default)
npm run typecheck   # tsc --noEmit
```

## Collecting data

```bash
npm run collect -- --per-source 55 [--source toi,ht] [--out data/reports.json]
```

For each source, run concurrently, the script:

1. Discovers articles over the 6-month window (`WINDOW_DAYS = 184`, `src/config/window.ts`).
2. Prefilters headlines for incident stories and canonicalises URLs.
3. Skips links already in the output file. Re-runs therefore add new rows and never create duplicates.
4. Picks `--per-source` candidates per city, evenly spaced in time. If some picks are dropped, it samples again from the rest.
5. Fetches and enriches each article: category, incident time, location, PII scrub.
6. Drops stories that fall outside the city area.

It writes the file after each source and city, then runs cross-source dedup (`event_id`) over all rows. The output is pretty JSON, newest first.

Geocoding results are cached in `data/geocode-cache.json`.

Politeness limits:
- at least 1 s between requests to the same host
- Anakin: at most 20 requests per minute
- Nominatim: at most 1 request per second, with a Safeit user agent

A full run takes a while.

Full article text is only used during extraction and is never stored. The stored `description` has personal details removed and is at most 300 characters.

## Merging police records

```bash
npm run merge:police -- path/to/incidents.jsonl [--out data/reports.json]
```

The input is JSONL in the incident schema of `merge_plan.md` §2. How rows are handled:

- **Skipped rows:**
  - `is_crime_incident: false`
  - older than the 6-month window
  - outside the city area
  - no link
- **Link:** `source_link`, or the first `mentions[].url` if missing. Police links keep `fir_no` (or `event_id`) as a `#fragment`, so several incidents from one FIR list stay separate.
- **Category:** kept if it is a known category id. Otherwise it is re-classified from `category`, `category_raw` and `title`.
- **Precision values:** `approx` becomes `date`, and geo `district` becomes `city`.
- **Missing coordinates:** resolved from `location_text` / `police_station` with the same gazetteer and Nominatim resolver.

Rows are upserted by `source_link`, and `event_id`s are re-assigned over the whole file. The police session's victim, accused and other personal fields are dropped.

## Merging review incidents (SafeMap)

```bash
npm run merge:reviews [-- data/reviews/foo.csv ...] [--out data/reports.json]
```

With no paths given, it merges every CSV in `data/reviews/`. Those CSVs come from the SafeMap Review Intelligence Actor: negative Google Maps reviews around city hot zones, classified by an LLM. There is one file per city (`safemap_<city>_dataset.csv`).

Each file has these leading columns: `title, category, source_link, date_time, location, publisher, description`. Its other columns include `place_name`, `zone`, `subcategory`, `latitude` and `longitude`.

How rows are handled:

- **Stored as:**
  - `source_type: review`
  - `source_name: Google Maps reviews`
  - `source_link`: the review itself
  - `geo_precision: address`: the coordinates are the reviewed place's Google Maps pin
- **Skipped rows:**
  - `record_type` is not `incident` (for example the zone-summary rows)
  - published before the 6-month window
  - outside the city areas
  - no link
- **City:** taken from the coordinates.
- **Category:** mapped to the Safe-it taxonomy, using the subcategory first and then the category:
  - Scam / Fraud → `fraud` (`cyber_fraud` for UPI, online or card fraud)
  - Harassment → `sexual_crime`
  - Accident → `road_accident`
  - Unsafe area, infrastructure hazards and natural disasters → `public_safety`
  - Crime → theft, robbery or snatching from the subcategory, otherwise the regex classifier
- **Dates:** `published_datetime` is the review date. `incident_datetime` stays `null`, because a review doesn't reliably date the incident.
- **Upserts:** rows are upserted by `source_link`, and `event_id`s are re-assigned over the whole file, as with police records. Re-running the merge is safe.

A review is a reviewer's own statement, not a verified incident. The CSVs store no reviewer personal data.

## API

All endpoints are `GET`, CORS-enabled and read `data/reports.json`.

**Common parameters (heatmap and reports):**

| Param | Default | Notes |
|---|---|---|
| `city` | required | `delhi` · `bengaluru` · `goa` |
| `from`, `to` | the last 184 days, ending today | `YYYY-MM-DD`, IST days, both inclusive. Filters on incident time, or published time if there is none. |
| `categories` | all | Comma list of category ids (see `/api/meta`) |
| `sources` | `news,police,review` | `police` matches every `police_*` source type; `review` matches Google Maps review incidents |

### `GET /api/heatmap`

Extra parameter: `res`, the H3 resolution (5–10, default 8).

- Uses one representative report per `event_id`: police sources first, then the best geo precision.
- Reports geocoded only to city level are never plotted.

Response:

```json
{ "city": "delhi", "from": "...", "to": "...", "res": 8, "total": 0, "max_count": 0,
  "cells": [{ "h3": "...", "lat": 0, "lng": 0, "count": 0, "categories": { "murder": 1 } }] }
```

### `GET /api/reports`

Extra parameters:
- `h3`: a cell index. Returns reports inside that cell, at the cell's resolution.
- `bbox`: `minLng,minLat,maxLng,maxLat`. Used when `h3` is not given.
- `limit`: default 50, maximum 200.
- `offset`

Response: `{ total, reports: Report[] }`, newest first. The `Report` fields follow `merge_plan.md` §2 and are defined in `src/types.ts`.

### `GET /api/meta`

Returns:
- cities, with centre and bounding box
- categories (`id`, `label`)
- report counts per `city × source_name × source_type`
- the date range covered

## Deploy

```bash
vercel deploy          # preview
vercel deploy --prod   # production
```

`vercel.json` bundles `data/**` with the `api/*.ts` functions. To publish new data, commit the updated `data/reports.json` and redeploy.

## Categories are provisional

The taxonomy lives in one file, `src/config/categories.ts`. It is derived from about 100 hand-labelled sample stories, and each category is a regex; the first match wins. Nothing else hard-codes category ids, so it can be replaced freely. Re-run `collect` on a fresh output file afterwards, because stored rows keep the category they were classified with.

## Data credits

- Place names and police station locations come from © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Geocoding uses [Nominatim](https://nominatim.org/), under its [usage policy](https://operations.osmfoundation.org/policies/nominatim/).
- News content belongs to the respective publishers. Only headlines, short summaries with personal details removed, and links are stored.
- Review incidents link to public Google Maps reviews. Only a generated headline, a short neutral summary and the review link are stored.

## Reprocessing and deploying

- `npm run reprocess` re-derives stored fields without re-scraping: PII scrub, category (from `src/config/categories.ts`), locations matched to generic police entries, and event grouping. Run it after changing categories.
- This app lives in `backend/` of the repo. In Vercel, set **Root Directory = `backend`** and deploy (`vercel deploy --prod` from this folder).
