# Plan: nomira-style "beware" map (5 categories, heatmap → pins, left detail panel)

Status: planned, not implemented. Scope: minimal changes on top of the current `backend/` + `frontend/`.

## 1. Categories: 5 user-facing groups derived in the backend at load time
- Add `group` to each entry in `backend/src/config/categories.ts`, plus `GROUPS` and `groupOf(report)`.
- Apply `groupOf` in `backend/src/api/store.ts#loadReports`, so there's no rewrite of `reports.json`.
- Expose `groups: [{id,label,color}]` in `/api/meta`.
- No new query param: the frontend already downloads all of a city's reports and filters by group in the browser.

| backend id | group |
|---|---|
| fraud, cyber_fraud | scam |
| sexual_crime, assault, robbery, snatching, kidnapping, extortion_organised_crime | harassment |
| road_accident | transport |
| murder, shooting, burglary_theft, drugs, drowning, unnatural_death, public_safety, other | excluded (`group: null`) |

- **Keyword overrides:** these apply only when the base group is scam or harassment, checked in this order against the title and description.
  - **stay:** `hotel|resort|guest house|homestay|hostel|PG|paying guest|airbnb|lodge|villa|landlord|tenant|accommodation|room rent|(flat|room|apartment|house) rental|booking (fraud|scam)`
  - **transport:** `taxi|cab|auto(-)rickshaw|auto driver|uber|ola|rapido|bike rental|bike taxi|rent-a-bike|rent-a-car|tout|bus conductor|bus driver|railway station|train|metro`
- **stay** will have very few news reports (about 3–6).
- **safe** has no rule. It shows as a disabled "coming soon" chip until community and review data (`data/reviews/*.csv`) is ingested.
- **Open decision:** murder and shooting (61 reports) are excluded by default. Changing that is a one-line edit.
- **Colours:** scam `#d95926`, harassment `#d55181`, transport `#3987e5`, stay `#9085e9`, safe `#199e70`.

## 2. Map: heatmap at low zoom, pins at high zoom (replaces hexagons)
- **Data:** reuse `getAllReports` (it already has lat/lng). Plot a report only if it passes all three filters:
  - `geo_precision !== 'city'`
  - `group != null`
  - it is the one representative kept for its `event_id` (police sources first, then the best precision)
- **Sources:** `reports-heat` (unclustered) feeds the heatmap, and `reports` (clustered: `clusterMaxZoom 14`, `clusterRadius 40`) feeds the pins.
- **Layers:**
  - `heat` (heatmap, `maxzoom 15`): opacity 0.9 at z11 → 0.35 at z13 → 0 at z15; radius 12 at z9 → 30 at z14; colours are the `--heat-*` ramp.
  - `clusters` + `cluster-count`: needs a `glyphs` URL in the style, or drop the count layer.
  - `pins`: circle coloured by group, radius 4 at z11 → 8 at z15, fading in from z11 to z12.
  - `pin-selected`
- **Interactions:**
  - pin click → `onSelect([id])`
  - cluster click → zoom in; if the reports share identical coordinates, show `getClusterLeaves` as a list instead
  - empty-map click → `onSelect(null)`
- **Legend:** "Heat = density · zoom in for pins · city-level reports not shown", plus a colour dot for each group.

## 3. Layout: detail panel moves to the left
- `index.html` puts `#sidebar` before `#map`.
- `base.css`: `grid-template-columns: var(--sidebar-w) 1fr`, `--sidebar-w: 380px`.
- The sidebar has three modes:
  - **summary:** counts per group (click one to filter), the 10 latest reports, and the number of reports that are city-level only.
  - **detail:** back button, group chip with the fine category, title, incident and published dates, location with a precision note, full description, source badge and link.
  - **list:** the reports behind a stack of pins at the same spot.
- There's no separate hero section. A tagline goes in the top bar.

## 4. Filters
- **City:** keep the buttons.
- **Category:** single-select chips `All · Scam · Harassment · Transport · Stay · Safe (disabled)`, each with a count. Stored in `state.group` and in `?group=` in the URL.
- **Area combobox:** remove.
- **Dates:** move under a collapsible "More".

## 5. Parallel tasks and shared contract
```js
createMap(el, { onSelect(ids|null) }) → { setCity(city), setReports(reports, groupColors), setSelected(id|null, { fly }) }
createSidebar(el, { onSelect(ids|null), onPickGroup(groupId) }) → { render({ mode, city, reports, selected, groups, categoryLabels, loading, error, cityLevelCount }) }
createFilters(el, { onChange(patch) }) → { render({ meta, state, counts, loading }) }
```
| Task | Files | Est. |
|---|---|---|
| A: backend groups + tests | `backend/src/config/categories.ts`, `src/types.ts`, `src/api/store.ts`, `src/api/meta.ts`, tests | 1–1.5 h |
| B: map rewrite (heatmap + clustered pins) | `frontend/src/map.js`, `styles/map.css` | 2–3 h |
| C: left panel (summary, detail, list) | `frontend/src/sidebar.js`, `styles/sidebar.css` | 1.5–2 h |
| D: filters, wiring, layout | `frontend/src/{filters,main,api}.js`, `index.html`, `styles/{filters,base}.css` | 2 h |

- A, B and C can start in parallel against the contract. D owns `main.js` and adds a local fallback for the group table, so the frontend doesn't depend on A being deployed first.
- **Joint QA afterwards:**
  - zoom from 10 to 16 in each city
  - stacked pins
  - the mobile layout
  - the empty "safe" chip
  - the back button

## Gotcha learned while shipping the hexagon version
In `frontend/src/map.js`, add sources and layers on MapLibre's `load` event only. Adding them earlier (on `style.load`, or synchronously when the style is already loaded) left layers that never painted, and fitting the camera before the container had a size was silently ignored.
