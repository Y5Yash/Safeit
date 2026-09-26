import { CITY_CONFIG, inCity } from '../config/cities.js';
import type { Geocode, LocationInput, LocationMatch, ResolvedLocation } from '../types.js';
import { extractPlacePhrase } from './nominatim.js';

/** A locality point is only trusted over a police-station point if it lies this close to the station. */
const STATION_LOCALITY_MAX_KM = 5;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

interface Point { text: string; lat: number; lng: number }

export async function resolveLocation(
  input: LocationInput,
  deps: { match: (i: LocationInput) => LocationMatch | null; geocode: Geocode },
): Promise<ResolvedLocation> {
  const done = (
    location_text: string | null, police_station: string | null, lat: number, lng: number,
    geo_precision: ResolvedLocation['geo_precision'],
  ): ResolvedLocation => ({ location_text, police_station, lat, lng, geo_precision, in_area: inCity(input.city, lat, lng) });

  if (typeof input.lat === 'number' && typeof input.lng === 'number') {
    return done(input.location_text ?? null, null, input.lat, input.lng, 'address');
  }

  let station: LocationMatch | null = null;
  let locality: Point | null = null;
  const take = (m: LocationMatch | null) => {
    if (!m) return;
    if (m.precision === 'police_station') station ??= m;
    else locality ??= m;
  };

  if (input.location_text) {
    take(deps.match({ ...input, title: input.location_text, keywords: [], text: '' }));
    if (!station && !locality) {
      const g = await deps.geocode(input.location_text, input.city);
      if (g) locality = { text: input.location_text, lat: g.lat, lng: g.lng };
    }
  }
  if (!station || !locality) take(deps.match(input));
  if (!locality) {
    const phrase = extractPlacePhrase(input.text);
    if (phrase) {
      const g = await deps.geocode(phrase, input.city);
      if (g) locality = { text: phrase, lat: g.lat, lng: g.lng };
    }
  }

  const s = station as LocationMatch | null;
  const l = locality as Point | null;
  if (s && l) {
    return haversineKm(s.lat, s.lng, l.lat, l.lng) <= STATION_LOCALITY_MAX_KM
      ? done(l.text, s.text, l.lat, l.lng, 'locality')
      : done(s.text, s.text, s.lat, s.lng, 'police_station');
  }
  if (s) return done(s.text, s.text, s.lat, s.lng, 'police_station');
  if (l) return done(l.text, null, l.lat, l.lng, 'locality');
  const c = CITY_CONFIG[input.city].center;
  return { location_text: input.location_text ?? null, police_station: null, lat: c.lat, lng: c.lng, geo_precision: 'city', in_area: true };
}
