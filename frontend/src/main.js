// App wiring: owns state, loads data, and connects the three UI modules.
//
// Module contracts (each module lives in its own file):
//   createMap(el, { onCellClick(h3 | null) })            → { setCity(city), setCells(cells), setSelection(h3Ids) }
//   createFilters(el, { onChange(patch) })              → { render({ meta, state, areas, loading }) }
//   createSidebar(el, { onClearSelection() })           → { render({ title, subtitle, reports, categoryLabels, loading, error, canClear }) }
// Shapes:
//   city  = { id, name, center: {lat,lng}, bbox: {minLat,maxLat,minLng,maxLng} }        (from /api/meta)
//   cell  = { h3, lat, lng, count, categories: {id: n} }                                 (from /api/heatmap)
//   state = { city, from, to, categories: string[] (empty = all), area: string | null }
//   areas = [{ name, count }]  (distinct location_text of mappable reports, most reports first)
import { latLngToCell } from 'https://esm.sh/h3-js@4.1.0';
import { getAllReports, getHeatmap, getMeta } from './api.js';
import { createFilters } from './filters.js';
import { createMap } from './map.js';
import { createSidebar } from './sidebar.js';

export const H3_RES = 7; // ~5 km² hexagons: visible at city zoom

const params = new URLSearchParams(location.search);
const state = { city: params.get('city') || 'delhi', from: params.get('from') || '', to: params.get('to') || '', categories: [], area: null };
let meta = null;
let cells = [];
let reports = [];
let selectedCell = null;
let loading = false;
let error = null;

const mappable = (r) => r.geo_precision !== 'city';
const cellOf = (r) => latLngToCell(r.lat, r.lng, H3_RES);

const map = createMap(document.getElementById('map'), {
  onCellClick(h3) {
    selectedCell = h3;
    state.area = null;
    update();
  },
});
const filters = createFilters(document.getElementById('filters'), {
  onChange(patch) {
    const reload = ['city', 'from', 'to', 'categories'].some((k) => k in patch && patch[k] !== state[k]);
    Object.assign(state, patch);
    selectedCell = null;
    if ('city' in patch) state.area = null;
    syncUrl();
    if (reload) load();
    else update();
  },
});
const sidebar = createSidebar(document.getElementById('sidebar'), {
  onClearSelection() {
    selectedCell = null;
    state.area = null;
    update();
  },
});

function syncUrl() {
  const q = new URLSearchParams();
  q.set('city', state.city);
  if (state.from) q.set('from', state.from);
  if (state.to) q.set('to', state.to);
  history.replaceState(null, '', `?${q}`);
}

function areasOf(rows) {
  const counts = new Map();
  for (const r of rows) if (mappable(r) && r.location_text) counts.set(r.location_text, (counts.get(r.location_text) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function update() {
  const city = meta?.cities.find((c) => c.id === state.city);
  const categoryLabels = Object.fromEntries((meta?.categories || []).map((c) => [c.id, c.label]));
  filters.render({ meta, state, areas: areasOf(reports), loading });

  let shown = reports;
  let title = city ? `${city.name}: all reports` : 'Reports';
  let subtitle = 'Tap a hexagon or pick an area to see what was reported there.';
  let selection = [];
  if (selectedCell) {
    shown = reports.filter((r) => mappable(r) && cellOf(r) === selectedCell);
    title = shown[0]?.location_text ? `Around ${shown[0].location_text}` : 'Selected area';
    subtitle = `${shown.length} report${shown.length === 1 ? '' : 's'} in this ~5 km² hexagon`;
    selection = [selectedCell];
  } else if (state.area) {
    shown = reports.filter((r) => mappable(r) && r.location_text === state.area);
    title = state.area;
    subtitle = `${shown.length} report${shown.length === 1 ? '' : 's'} located in this area`;
    selection = [...new Set(shown.map(cellOf))];
  }
  map.setSelection(selection, { fit: Boolean(state.area) && !selectedCell });
  sidebar.render({ title, subtitle, reports: shown, categoryLabels, loading, error, canClear: Boolean(selectedCell || state.area) });
}

async function load() {
  const city = meta.cities.find((c) => c.id === state.city) || meta.cities[0];
  state.city = city.id;
  map.setCity(city);
  loading = true;
  error = null;
  update();
  const q = { city: state.city, from: state.from || undefined, to: state.to || undefined, categories: state.categories.length ? state.categories : undefined };
  try {
    const [heat, rows] = await Promise.all([getHeatmap({ ...q, res: H3_RES }), getAllReports(q)]);
    cells = heat.cells;
    reports = rows;
  } catch (e) {
    error = e.message;
    cells = [];
    reports = [];
  }
  loading = false;
  map.setCells(cells);
  update();
}

(async () => {
  try {
    meta = await getMeta();
  } catch (e) {
    error = `Could not reach the Safe-it API (${e.message})`;
    update();
    return;
  }
  syncUrl();
  await load();
})();
