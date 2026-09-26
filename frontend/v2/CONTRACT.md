# v2 ("Beware" map) contract

Design spec: /Users/yash/MyProjects/Safe-it/safeit/docs/superpowers/plans/2026-09-26-nomira-style-map.md
v1 (classic hexagon map) stays at `/` and is untouched except for a toggle link. v2 lives at `/v2/`.
Both top bars carry a toggle: "Classic map ⇄ Beware map" (v1 → `/v2/?city=…`, v2 → `/?city=…`).

## Groups (6 user-facing categories; backend derives `group` on every report)
| id | label | colour | backend categories |
|---|---|---|---|
| violent | Violent crime | #e66767 | murder, shooting |
| harassment | Harassment | #d55181 | sexual_crime, assault, robbery, snatching, kidnapping, extortion_organised_crime |
| scam | Scam | #d95926 | fraud, cyber_fraud |
| transport | Transport | #3987e5 | road_accident |
| stay | Stay | #9085e9 | (keyword override only) |
| safe | Safe | #199e70 | none yet (disabled "coming soon") |
Excluded (`group: null`, never plotted/listed in v2): burglary_theft, drugs, drowning, unnatural_death, public_safety, other.
Keyword overrides (only when base group is scam or harassment), checked in order on `title + ' ' + description`:
stay → `/\b(hotels?|resorts?|guest ?houses?|homestays?|hostels?|PGs?|paying guest|airbnb|lodges?|villas?|landlord|tenants?|accommodation|room rent|(flat|room|apartment|house) rental|booking (fraud|scam))\b/i`;
transport → `/\b(taxis?|cabs?|auto(-| )?rickshaws?|auto drivers?|uber|ola|rapido|bike (rental|taxi)|rent-a-(bike|car)|touts?|bus (conductor|driver)|railway station|trains?|metro)\b/i`.

API: `/api/reports` rows gain `group: GroupId | null`; `/api/meta` gains `groups: [{ id, label, color }]` in the order above.
Frontend must not depend on the backend deploy order: `v2/src/groups.js` exports the same table + `groupOf(report)` fallback used when `report.group` is undefined.

## Module contracts (v2/src/*.js, plain ES modules, MapLibre global `maplibregl`)
```js
// groups.js (owned by task D)
export const GROUPS = [{ id, label, color, disabled? }];            // table above; safe has disabled: true
export function groupOf(report): GroupId | null;                    // report.group ?? fallback mapping

// map.js (task B)
createMap(el, { onSelect(ids: string[] | null) })
  → { setCity(city), setReports(reports, groupColors /* {id: hex} */), setSelected(id | null, { fly?: boolean }) }
//   reports passed in are already filtered: group != null, geo_precision !== 'city', one per event_id.

// sidebar.js (task C) — LEFT panel
createSidebar(el, { onSelect(ids: string[] | null), onPickGroup(groupId | null) })
  → { render({ mode: 'summary' | 'detail' | 'list', city, reports, selected, groups, categoryLabels, counts, loading, error, cityLevelCount }) }
//   reports = all visible reports for the city+group filter (incl. city-level ones); selected = Report[] (1 for detail, >1 for list)
//   counts = { [groupId]: n } over mappable reports for the city (independent of the group filter)

// filters.js (task D)
createFilters(el, { onChange(patch /* {city} | {group} | {from} | {to} */) })
  → { render({ meta, state, counts, loading }) }
// state = { city, group: string | null, from, to }; URL: ?city=&group=&from=&to=
```
Shared helpers already available: `../../src/api.js` (getMeta, getAllReports, API_BASE) — import it from v2 with `../../src/api.js`.
City shape: `{ id, name, center:{lat,lng}, bbox:{minLat,maxLat,minLng,maxLng} }`.

## MapLibre gotcha (learned the hard way in v1)
Add sources/layers ONLY in `map.on('load', …)` (queue calls until then). Don't add them on `style.load` or synchronously.
Fit the city with `duration: 0` for the first fit, and re-fit on container resize (ResizeObserver) until the user moves the map.
Basemap: Esri Dark Gray raster (`…/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` + `World_Dark_Gray_Reference`), see v1 `src/map.js`; support `?basemap=none`.
