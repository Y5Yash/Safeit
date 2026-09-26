// v2 map module: Esri dark-gray raster basemap + report heatmap (low zoom) and
// clustered, group-coloured pins (high zoom). Contract (see ../CONTRACT.md):
//   createMap(el, { onSelect(ids | null) }) → { setCity, setReports, setSelected }
// MapLibre GL v4 is loaded by the page as the global `maplibregl`.

const SRC_HEAT = 'reports-heat';
const SRC_PINS = 'reports';
const L_HEAT = 'heat';
const L_CLUSTERS = 'clusters';
const L_COUNT = 'cluster-count';
const L_PINS = 'pins';
const L_SELECTED = 'pin-selected';

const CLUSTER_MAX_ZOOM = 14;
// demotiles serves "Noto Sans Regular" (200); "Open Sans Regular" returns 404 there.
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];
const NONE = '\u0000__none__'; // filter value that matches no report id

function humanize(id) {
  const s = String(id).replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

export function createMap(el, { onSelect } = {}) {
  const select = (ids) => { if (typeof onSelect === 'function') onSelect(ids); };
  el.classList.add('bw-map');

  const noBase = new URLSearchParams(location.search).get('basemap') === 'none';
  const map = new maplibregl.Map({
    container: el,
    // Esri Dark Gray raster tiles: no API key, loads reliably.
    style: {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        base: {
          type: 'raster', tileSize: 256, maxzoom: 16,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors',
        },
        labels: {
          type: 'raster', tileSize: 256, maxzoom: 16,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
        },
      },
      // ?basemap=none renders without tiles (offline demos / debugging).
      layers: noBase
        ? [{ id: 'bg', type: 'background', paint: { 'background-color': '#15181d' } }]
        : [{ id: 'base', type: 'raster', source: 'base' }, { id: 'labels', type: 'raster', source: 'labels' }],
    },
    center: [0, 20],
    zoom: 2,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }));

  // ---- Legend (bottom-right; the left side is the panel) ----
  const legend = document.createElement('div');
  legend.className = 'bw-legend';
  const note = document.createElement('div');
  note.className = 'bw-legend-note';
  note.textContent = 'Heat = density of reports · zoom in for pins · city-level reports not shown';
  const groupsRow = document.createElement('div');
  groupsRow.className = 'bw-legend-groups';
  legend.append(note, groupsRow);
  el.appendChild(legend);
  let legendKey = '';

  function renderLegend(groupColors) {
    const entries = Object.entries(groupColors || {});
    const key = JSON.stringify(entries);
    if (key === legendKey) return;
    legendKey = key;
    groupsRow.replaceChildren();
    for (const [id, color] of entries) {
      const item = document.createElement('span');
      item.className = 'bw-legend-item';
      const dot = document.createElement('span');
      dot.className = 'bw-legend-dot';
      dot.style.background = color;
      item.append(dot, document.createTextNode(humanize(id)));
      groupsRow.appendChild(item);
    }
    groupsRow.hidden = entries.length === 0;
  }

  // ---- State + load queue ----
  let loaded = false;
  const queue = []; // calls made before 'load', replayed in order
  const whenLoaded = (fn) => { if (loaded) fn(); else queue.push(fn); };

  let data = emptyFC();
  let byId = new Map(); // String(id) → { id, lng, lat }
  let selectedId = null;

  function addLayers() {
    map.addSource(SRC_HEAT, { type: 'geojson', data });
    map.addSource(SRC_PINS, {
      type: 'geojson', data,
      cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM, clusterRadius: 40,
    });

    map.addLayer({
      id: L_HEAT, type: 'heatmap', source: SRC_HEAT, maxzoom: 15,
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 11, 1.4, 14, 1.8],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 10, 20, 12, 26, 14, 32],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#6b3219',
          0.4, '#a3431f',
          0.6, '#d95926',
          0.8, '#f08a5d',
          1, '#ffc2a1',
        ],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 13, 0.35, 15, 0],
      },
    });

    const fadeIn = ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 1];

    map.addLayer({
      id: L_CLUSTERS, type: 'circle', source: SRC_PINS, minzoom: 11,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(255,255,255,0.2)',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 14, 5, 18, 15, 24],
        'circle-opacity': fadeIn,
        'circle-stroke-opacity': fadeIn,
      },
    });

    map.addLayer({
      id: L_COUNT, type: 'symbol', source: SRC_PINS, minzoom: 11,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONT,
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff', 'text-opacity': fadeIn },
    });

    map.addLayer({
      id: L_PINS, type: 'circle', source: SRC_PINS, minzoom: 11,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#9aa0a6'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8],
        'circle-stroke-color': '#0e1116',
        'circle-stroke-width': 1.5,
        'circle-opacity': fadeIn,
        'circle-stroke-opacity': fadeIn,
      },
    });

    // Uses the unclustered source so the selection ring shows even while its pin is
    // folded into a cluster (e.g. right after a fly-to at zoom 14 = clusterMaxZoom).
    map.addLayer({
      id: L_SELECTED, type: 'circle', source: SRC_HEAT,
      filter: selectedFilter(),
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#9aa0a6'],
        'circle-radius': 11,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
  }

  function selectedFilter() {
    return ['==', ['get', 'id'], selectedId == null ? NONE : selectedId];
  }

  // ---- City fitting (v1 pattern) ----
  // Until the user pans/zooms, re-fit the city whenever the container size changes: a fit
  // issued before layout has settled (e.g. zero-size container) is otherwise lost.
  let lastCity = null;
  let userMoved = false;
  map.on('dragstart', () => { userMoved = true; });
  map.on('wheel', () => { userMoved = true; });
  map.on('touchstart', () => { userMoved = true; });
  new ResizeObserver(() => {
    map.resize();
    if (lastCity && !userMoved) fitCity(lastCity, 0);
  }).observe(el);

  function fitCity(city, duration = 600) {
    const b = city?.bbox;
    if (!b) return;
    if (!lastCity) duration = 0; // first view: jump, don't animate
    lastCity = city;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    map.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], {
      padding: Math.min(30, w / 4, h / 4),
      duration: w && h ? duration : 0,
    });
  }

  map.once('load', () => {
    if (loaded) return;
    loaded = true;
    addLayers();
    for (const fn of queue.splice(0)) fn();
  });

  // ---- Reports ----
  function buildFC(reports, groupColors) {
    const features = [];
    const index = new Map();
    for (const r of reports || []) {
      const lat = Number(r.lat), lng = Number(r.lng);
      if (r.id == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      index.set(String(r.id), { id: r.id, lng, lat });
      features.push({
        type: 'Feature',
        properties: {
          id: r.id,
          group: r.group ?? null,
          color: (groupColors && groupColors[r.group]) || '#9aa0a6',
          title: r.title || '',
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      });
    }
    return { fc: { type: 'FeatureCollection', features }, index };
  }

  function applyData() {
    map.getSource(SRC_HEAT)?.setData(data);
    map.getSource(SRC_PINS)?.setData(data);
  }

  // ---- Hover popup ----
  let popup = null;
  function clearHover() {
    popup?.remove();
    popup = null;
    map.getCanvas().style.cursor = '';
  }
  map.on('mousemove', L_PINS, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    map.getCanvas().style.cursor = 'pointer';
    const content = document.createElement('div');
    content.className = 'bw-popup';
    content.textContent = f.properties.title || 'Report';
    if (!popup) popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    popup.setLngLat(f.geometry.coordinates.slice()).setDOMContent(content).addTo(map);
  });
  map.on('mouseleave', L_PINS, clearHover);
  map.on('mouseenter', L_CLUSTERS, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', L_CLUSTERS, () => { map.getCanvas().style.cursor = ''; });

  // ---- Clicks (single handler so pin/cluster/empty never double-fire) ----
  map.on('click', async (e) => {
    if (!loaded) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: [L_PINS, L_CLUSTERS] });
    const pin = hits.find((f) => f.layer.id === L_PINS);
    if (pin) { select([pin.properties.id]); return; }
    const cluster = hits.find((f) => f.layer.id === L_CLUSTERS);
    if (!cluster) { select(null); return; }

    const src = map.getSource(SRC_PINS);
    const clusterId = cluster.properties.cluster_id;
    const center = cluster.geometry.coordinates.slice();
    try {
      const zoom = await src.getClusterExpansionZoom(clusterId);
      if (zoom > 16 || zoom > CLUSTER_MAX_ZOOM + 2) {
        // Identical coordinates never split: show the reports as a list instead.
        const leaves = await src.getClusterLeaves(clusterId, 50, 0);
        select(leaves.map((l) => l.properties.id));
      } else {
        map.easeTo({ center, zoom });
      }
    } catch {
      // Cluster vanished (data changed mid-click) — nothing to do.
    }
  });

  return {
    setCity(city) {
      userMoved = false;
      whenLoaded(() => fitCity(city));
    },

    setReports(reports, groupColors) {
      renderLegend(groupColors);
      const built = buildFC(reports, groupColors);
      data = built.fc;
      byId = built.index;
      whenLoaded(applyData);
    },

    setSelected(id, { fly = false } = {}) {
      const entry = id == null ? null : byId.get(String(id));
      selectedId = id == null ? null : (entry ? entry.id : id);
      whenLoaded(() => {
        map.setFilter(L_SELECTED, selectedFilter());
        if (fly && entry) {
          map.easeTo({ center: [entry.lng, entry.lat], zoom: Math.max(map.getZoom(), 14) });
        }
      });
    },
  };
}
