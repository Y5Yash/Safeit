// v2 "Beware" map wiring: owns state, loads data, and connects filters, map and the left panel.
// Contracts: see ../CONTRACT.md.
import { getAllReports, getMeta } from '../../src/api.js';
import { createFilters } from './filters.js';
import { GROUPS, groupOf } from './groups.js';
import { createMap } from './map.js';
import { createSidebar } from './sidebar.js';

const params = new URLSearchParams(location.search);
const state = {
  city: params.get('city') || 'delhi',
  group: params.get('group') || null,
  from: params.get('from') || '',
  to: params.get('to') || '',
};
let meta = null;
let groups = GROUPS;
let groupColors = Object.fromEntries(GROUPS.map((g) => [g.id, g.color]));
let reports = []; // raw rows for city + dates
let mappable = []; // grouped, located, one per event
let cityLevel = []; // grouped, city-level only, one per event, not already on the map
let byId = new Map();
let counts = null;
let selection = null; // string[] | null
let loading = false;
let error = null;
let loadSeq = 0;

const PRECISION_RANK = { address: 3, police_station: 2, locality: 1 };
const score = (r) => (String(r.source_type || '').startsWith('police_') ? 10 : 0) + (PRECISION_RANK[r.geo_precision] || 0);

function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = r.event_id || r.id;
    const cur = best.get(key);
    if (!cur || score(r) > score(cur)) best.set(key, r);
  }
  return [...best.values()];
}

const inGroup = (r) => !state.group || r._group === state.group;

const map = createMap(document.getElementById('map'), {
  onSelect(ids) {
    // From a pin click: no fly, the user is already looking at it.
    select(ids, false);
  },
});
const sidebar = createSidebar(document.getElementById('sidebar'), {
  onSelect(ids) {
    select(ids, true);
  },
  onPickGroup(groupId) {
    setFilters({ group: groupId || null });
  },
});
const filters = createFilters(document.getElementById('filters'), {
  onChange(patch) {
    setFilters(patch);
  },
});

function select(ids, fromPanel) {
  selection = ids && ids.length ? [...ids] : null;
  if (!selection) map.setSelected(null);
  else if (selection.length === 1) map.setSelected(selection[0], { fly: fromPanel });
  update();
}

function setFilters(patch) {
  const reload = ['city', 'from', 'to'].some((k) => k in patch && patch[k] !== state[k]);
  const groupChanged = 'group' in patch && patch.group !== state.group;
  Object.assign(state, patch);
  syncUrl();
  if (reload) {
    selection = null;
    map.setSelected(null);
    load();
    return;
  }
  if (groupChanged) {
    // Drop a selection that the new group filter hides.
    if (selection) {
      selection = selection.filter((id) => byId.get(id) && inGroup(byId.get(id)));
      if (!selection.length) {
        selection = null;
        map.setSelected(null);
      }
    }
    map.setReports(mappable.filter(inGroup), groupColors);
  }
  update();
}

function syncUrl() {
  const q = new URLSearchParams(location.search);
  for (const k of ['city', 'group', 'from', 'to']) {
    if (state[k]) q.set(k, state[k]);
    else q.delete(k);
  }
  history.replaceState(null, '', `?${q}`);
  const toV1 = document.getElementById('to-v1');
  if (toV1) toV1.href = `../?city=${encodeURIComponent(state.city)}`;
}

function derive() {
  const grouped = [];
  for (const r of reports) {
    const g = groupOf(r);
    if (g) grouped.push({ ...r, _group: g, group: g });
  }
  mappable = dedupe(grouped.filter((r) => r.geo_precision !== 'city'));
  const onMap = new Set(mappable.map((r) => r.event_id || r.id));
  cityLevel = dedupe(grouped.filter((r) => r.geo_precision === 'city' && !onMap.has(r.event_id || r.id)));
  byId = new Map([...mappable, ...cityLevel].map((r) => [r.id, r]));
  counts = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  for (const r of mappable) counts[r._group] = (counts[r._group] || 0) + 1;
}

function update() {
  const city = meta?.cities.find((c) => c.id === state.city) || null;
  const categoryLabels = Object.fromEntries((meta?.categories || []).map((c) => [c.id, c.label]));
  filters.render({ meta, state, counts, loading });

  const byDate = (a, b) => String(b.incident_datetime || b.published_datetime || '').localeCompare(String(a.incident_datetime || a.published_datetime || ''));
  const visible = [...mappable, ...cityLevel].filter(inGroup).sort(byDate);
  const selected = (selection || []).map((id) => byId.get(id)).filter(Boolean);
  const mode = selected.length === 0 ? 'summary' : selected.length === 1 ? 'detail' : 'list';
  sidebar.render({
    mode,
    city,
    reports: visible,
    selected,
    groups,
    categoryLabels,
    counts: counts || {},
    loading,
    error,
    cityLevelCount: cityLevel.filter(inGroup).length,
    group: state.group,
  });
}

async function load() {
  const city = meta.cities.find((c) => c.id === state.city) || meta.cities[0];
  state.city = city.id;
  syncUrl();
  map.setCity(city);
  const seq = ++loadSeq;
  loading = true;
  error = null;
  update();
  let rows = [];
  try {
    rows = await getAllReports({ city: state.city, from: state.from || undefined, to: state.to || undefined });
  } catch (e) {
    if (seq !== loadSeq) return;
    error = e.message;
  }
  if (seq !== loadSeq) return;
  reports = rows;
  derive();
  loading = false;
  map.setReports(mappable.filter(inGroup), groupColors);
  update();
}

(async () => {
  syncUrl();
  try {
    meta = await getMeta();
  } catch (e) {
    error = `Could not reach the Safe-it API (${e.message})`;
    update();
    return;
  }
  if (Array.isArray(meta.groups) && meta.groups.length) {
    // Backend labels/colours win; keep the local "disabled" flag and order.
    const remote = Object.fromEntries(meta.groups.map((g) => [g.id, g]));
    groups = GROUPS.map((g) => ({ ...g, ...(remote[g.id] || {}), disabled: g.disabled }));
    groupColors = Object.fromEntries(groups.map((g) => [g.id, g.color]));
  }
  if (state.group && !groups.some((g) => g.id === state.group && !g.disabled)) state.group = null;
  await load();
})();
