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
