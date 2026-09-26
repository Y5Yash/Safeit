import { describe, expect, it, vi } from 'vitest';
import { haversineKm, resolveLocation } from '../../src/geo/resolve.js';
import type { LocationInput } from '../../src/types.js';

const base: LocationInput = { city: 'bengaluru', title: 't', keywords: [], text: '' };
const madiwala = { text: 'Madiwala Police Station', lat: 12.92, lng: 77.62, precision: 'police_station' as const };

describe('resolveLocation', () => {
  it('uses provided coordinates first, with address precision', async () => {
    const geocode = vi.fn();
    const r = await resolveLocation({ ...base, lat: 12.93, lng: 77.62, location_text: 'Koramangala' },
      { match: () => null, geocode });
    expect(r).toEqual({
      location_text: 'Koramangala', police_station: null, lat: 12.93, lng: 77.62, geo_precision: 'address', in_area: true,
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it('uses the gazetteer match when available', async () => {
    const r = await resolveLocation(base, {
      match: () => ({ text: 'HSR Layout', lat: 12.91, lng: 77.64, precision: 'locality' }), geocode: vi.fn() });
    expect(r).toMatchObject({ location_text: 'HSR Layout', police_station: null, geo_precision: 'locality', in_area: true });
  });

  it('matches location_text for police records before free text and reports the station', async () => {
    const match = vi.fn((i: LocationInput) => (i.title === 'Madiwala PS' ? madiwala : null));
    const r = await resolveLocation({ ...base, location_text: 'Madiwala PS' }, { match, geocode: vi.fn() });
    expect(r).toEqual({
      location_text: 'Madiwala Police Station', police_station: 'Madiwala Police Station',
      lat: 12.92, lng: 77.62, geo_precision: 'police_station', in_area: true,
    });
  });

  it('falls back to Nominatim on a place phrase', async () => {
    const geocode = vi.fn(async () => ({ lat: 12.917, lng: 77.623, display_name: 'Silk Board' }));
    const r = await resolveLocation({ ...base, text: 'A man was robbed near Silk Board Junction.' }, { match: () => null, geocode });
    expect(geocode).toHaveBeenCalledWith('Silk Board Junction', 'bengaluru');
    expect(r).toMatchObject({ location_text: 'Silk Board Junction', police_station: null, geo_precision: 'locality', in_area: true });
  });

  it('prefers a locality point near the station (<=5 km), else the station point', async () => {
    const text = 'The theft happened near Silk Board Junction; a case was registered with the Madiwala police station.';
    // ~0.6 km from the station: locality wins.
    const near = await resolveLocation({ ...base, text }, {
      match: () => madiwala, geocode: async () => ({ lat: 12.917, lng: 77.623, display_name: 'Silk Board' }) });
    expect(near).toMatchObject({ location_text: 'Silk Board Junction', police_station: 'Madiwala Police Station', lat: 12.917, lng: 77.623, geo_precision: 'locality' });
    // ~20 km away (a wrong same-named hit): the station point wins.
    const far = await resolveLocation({ ...base, text }, {
      match: () => madiwala, geocode: async () => ({ lat: 13.1, lng: 77.62, display_name: 'Elsewhere' }) });
    expect(far).toEqual({
      location_text: 'Madiwala Police Station', police_station: 'Madiwala Police Station',
      lat: 12.92, lng: 77.62, geo_precision: 'police_station', in_area: true,
    });
  });

  it('flags out-of-area results (Nelamangala) instead of plotting them', async () => {
    const r = await resolveLocation(base, {
      match: () => ({ text: 'Nelamangala', lat: 13.0976, lng: 77.391, precision: 'locality' }), geocode: vi.fn() });
    expect(r.in_area).toBe(false);
  });

  it('falls back to the city centre with city precision', async () => {
    const r = await resolveLocation(base, { match: () => null, geocode: async () => null });
    expect(r).toEqual({ location_text: null, police_station: null, lat: 12.9716, lng: 77.5946, geo_precision: 'city', in_area: true });
  });
});

describe('haversineKm', () => {
  it('computes great-circle distance', () => {
    expect(haversineKm(12.92, 77.62, 12.92, 77.62)).toBe(0);
    expect(haversineKm(12.92, 77.62, 13.01, 77.62)).toBeCloseTo(10.0, 0);
  });
});
