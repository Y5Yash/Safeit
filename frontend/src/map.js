// Map module: wraps a MapLibre GL map with an Esri dark-gray raster basemap and an H3
// hexagon heatmap layer. See main.js for the module contract:
//   createMap(el, { onCellClick(h3 | null) }) → { setCity, setCells, setSelection }
import { cellToBoundary } from 'https://esm.sh/h3-js@4.1.0';

const SOURCE_CELLS = 'cells';
const LAYER_FILL = 'cells-fill';
const LAYER_OUTLINE = 'cells-outline';
const LAYER_HOVER = 'cells-hover';
const SOURCE_SELECTION = 'selection';
const LAYER_SELECTION = 'selection-outline';

// Heat colours pulled from the CSS variables defined in base.css (--heat-1..5).
const HEAT_COLORS = ['#6b3219', '#a3431f', '#d95926', '#f08a5d', '#ffc2a1'];

function readCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function humanize(id) {
  return String(id).replace(/_/g, ' ');
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

// Turn an h3 cell boundary into a closed GeoJSON polygon ring in [lng, lat] order.
function ringFor(h3) {
  const ring = cellToBoundary(h3, true); // true = geoJson coord order [lng, lat]
  const closed = ring.slice();
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) closed.push(first);
  return closed;
}

// Bounding box (as [[minLng,minLat],[maxLng,maxLat]]) of a set of h3 cells.
function bboxOfCells(h3Ids) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const h3 of h3Ids) {
    for (const [lng, lat] of cellToBoundary(h3, true)) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

export function createMap(el, { onCellClick }) {
  const heatColors = [1, 2, 3, 4, 5].map((i) => readCssVar(`--heat-${i}`, HEAT_COLORS[i - 1]));

  const noBase = new URLSearchParams(location.search).get('basemap') === 'none';
  const map = new maplibregl.Map({
    container: el,
    // Esri Dark Gray raster tiles: no API key, loads reliably (inline style → 'load' fires immediately).
    style: {
      version: 8,
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

  // Legend overlay (fewer → more reports), built once and left in the DOM.
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  const scale = document.createElement('div');
  scale.className = 'legend-scale';
  const swatches = document.createElement('span');
  swatches.className = 'legend-swatches';
  for (const color of heatColors) {
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = color;
    swatches.appendChild(sw);
  }
  scale.append('fewer ', swatches, ' more reports');
  const note = document.createElement('div');
  note.className = 'legend-note';
  note.textContent = 'Hexagon ≈ 5 km² · city-level reports not shown';
  legend.append(scale, note);
  el.appendChild(legend);

  let loaded = false;
  let pendingCity = null; // city to fitBounds to once loaded
  let pendingCells = null; // cells FeatureCollection payload to load once loaded
  let currentCells = emptyFC();
  let hoveredId = null;
  let popup = null;

  function levelColorExpression() {
    // Step expression: level is an integer 1-5, colour by matching level.
    return [
      'match',
      ['get', 'level'],
      1, heatColors[0],
      2, heatColors[1],
      3, heatColors[2],
      4, heatColors[3],
      5, heatColors[4],
      heatColors[0],
    ];
  }

  function addLayers() {
    map.addSource(SOURCE_CELLS, { type: 'geojson', data: currentCells });
    map.addLayer({
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE_CELLS,
      paint: {
        'fill-color': levelColorExpression(),
        'fill-opacity': 0.75,
      },
    });
    map.addLayer({
      id: LAYER_OUTLINE,
      type: 'line',
      source: SOURCE_CELLS,
      paint: {
        'line-color': '#0e1116',
        'line-width': 1,
      },
    });
    // Hover highlight: brighter outline on the hovered cell only.
    map.addLayer({
      id: LAYER_HOVER,
      type: 'line',
      source: SOURCE_CELLS,
      filter: ['==', ['get', 'h3'], ''],
      paint: {
        'line-color': '#ffffff',
        'line-width': 2,
      },
    });

    map.addSource(SOURCE_SELECTION, { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: LAYER_SELECTION,
      type: 'line',
      source: SOURCE_SELECTION,
      paint: {
        'line-color': '#f4f4f1',
        'line-width': 2.5,
      },
    });
  }

  // 'style.load' fires once layers can be added, without waiting for every basemap tile ('load' does).
  // Keep the canvas matched to its container (layout can settle after the map is created).
  // Until the user pans/zooms, re-fit the city whenever the container size changes: a fit issued
  // before layout has settled (e.g. zero-size container) is otherwise lost.
  let lastCity = null;
  let userMoved = false;
  map.on('dragstart', () => { userMoved = true; });
  map.on('wheel', () => { userMoved = true; });
  new ResizeObserver(() => {
    map.resize();
    if (lastCity && !userMoved) fitCity(lastCity, 0);
  }).observe(el);
  function onReady() {
    if (loaded) return;
    loaded = true;
    addLayers();
    if (pendingCells) {
      applyCells(pendingCells);
      pendingCells = null;
    }
    if (pendingCity) {
      fitCity(pendingCity, 0); // first view: jump, don't animate
      pendingCity = null;
    }
  }
  // Inline styles can finish loading synchronously, before a listener would be attached.
  map.once('load', onReady);
  // Deferred one frame: adding layers inside the constructor's call stack breaks the first render.

  function fitCity(city, duration = 600) {
    const b = city?.bbox;
    if (!b) return;
    if (!lastCity) duration = 0; // first view: jump, don't animate
    lastCity = city;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    map.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: Math.min(30, w / 4, h / 4), duration: w && h ? duration : 0 });
  }

  function levelOf(count, max) {
    if (!max || max <= 0 || !count) return 1;
    return Math.max(1, Math.ceil((5 * count) / max));
  }

  function buildFC(cells) {
    const max = cells.reduce((m, c) => Math.max(m, c.count || 0), 0);
    return {
      type: 'FeatureCollection',
      features: cells.map((c) => ({
        type: 'Feature',
        properties: {
          h3: c.h3,
          count: c.count,
          level: levelOf(c.count, max),
          categories: c.categories || {},
        },
        geometry: { type: 'Polygon', coordinates: [ringFor(c.h3)] },
      })),
    };
  }

  function applyCells(cells) {
    currentCells = buildFC(cells);
    const src = map.getSource(SOURCE_CELLS);
    if (src) src.setData(currentCells);
  }

  function clearHover() {
    if (hoveredId != null) {
      map.setFilter(LAYER_HOVER, ['==', ['get', 'h3'], '']);
      hoveredId = null;
    }
    if (popup) {
      popup.remove();
      popup = null;
    }
    map.getCanvas().style.cursor = '';
  }

  map.on('mousemove', LAYER_FILL, (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    map.getCanvas().style.cursor = 'pointer';
    const h3 = f.properties.h3;
    if (h3 !== hoveredId) {
      hoveredId = h3;
      map.setFilter(LAYER_HOVER, ['==', ['get', 'h3'], h3]);
    }
    const count = f.properties.count;
    let categories = {};
    try {
      categories = typeof f.properties.categories === 'string' ? JSON.parse(f.properties.categories) : f.properties.categories;
    } catch {
      categories = {};
    }
    const topCats = Object.entries(categories || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => humanize(id));
    // Build the tooltip via DOM nodes (not setHTML) so category/report data
    // from the API is never interpreted as markup.
    const content = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${count} report${count === 1 ? '' : 's'}`;
    content.appendChild(strong);
    if (topCats.length) {
      const line = document.createElement('div');
      line.textContent = topCats.join(', ');
      content.appendChild(line);
    }
    if (!popup) {
      popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    }
    popup.setLngLat(e.lngLat).setDOMContent(content).addTo(map);
  });

  map.on('mouseleave', LAYER_FILL, clearHover);

  map.on('click', LAYER_FILL, (e) => {
    const f = e.features && e.features[0];
    onCellClick(f ? f.properties.h3 : null);
  });

  // Click on empty map (no hexagon under the cursor) clears selection.
  map.on('click', (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_FILL] });
    if (!hits.length) onCellClick(null);
  });

  function boundsContain(bounds, bbox) {
    const [[minLng, minLat], [maxLng, maxLat]] = bbox;
    return (
      bounds.getWest() <= minLng &&
      bounds.getEast() >= maxLng &&
      bounds.getSouth() <= minLat &&
      bounds.getNorth() >= maxLat
    );
  }

  return {
    setCity(city) {
      userMoved = false;
      if (!loaded) {
        pendingCity = city;
        return;
      }
      fitCity(city);
    },
    setCells(cells) {
      if (!loaded) {
        pendingCells = cells;
        return;
      }
      applyCells(cells);
    },
    setSelection(h3Ids, { fit = false } = {}) {
      const ids = h3Ids || [];
      const fc = {
        type: 'FeatureCollection',
        features: ids.map((h3) => ({
          type: 'Feature',
          properties: { h3 },
          geometry: { type: 'Polygon', coordinates: [ringFor(h3)] },
        })),
      };
      const apply = () => {
        const src = map.getSource(SOURCE_SELECTION);
        if (src) src.setData(fc);
      };
      if (!loaded) {
        map.once('load', apply);
        return;
      }
      apply();

      if (fit && ids.length) {
        const bbox = bboxOfCells(ids);
        if (bbox) {
          const bounds = map.getBounds();
          if (!boundsContain(bounds, bbox)) {
            map.fitBounds(bbox, { padding: 60, duration: 600 });
          }
        }
      }
    },
  };
}
