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
    let hits: { lat: string; lon: string; display_name: string }[];
    try { hits = (await res.json()) as typeof hits; } catch { return null; }
    const h = Array.isArray(hits) ? hits[0] : undefined;
    const value = h ? { lat: Number(h.lat), lng: Number(h.lon), display_name: h.display_name }
      : { lat: null, lng: null, display_name: null };
    await opts.cache.set(key, value);
    return h ? { lat: Number(h.lat), lng: Number(h.lon), display_name: h.display_name } : null;
  };
  return { geocode };
}
