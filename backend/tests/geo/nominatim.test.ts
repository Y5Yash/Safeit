import { describe, expect, it, vi } from 'vitest';
import { createNominatim, extractPlacePhrase } from '../../src/geo/nominatim.js';
import type { GeoCache, GeoCacheValue } from '../../src/types.js';

function memCache(): GeoCache & { store: Map<string, GeoCacheValue> } {
  const store = new Map<string, GeoCacheValue>();
  return { store, get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
}

describe('nominatim', () => {
  it('queries within the city viewbox with a UA, and caches hits and misses', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.searchParams.get('bounded')).toBe('1');
      expect(u.searchParams.get('countrycodes')).toBe('in');
      expect(u.searchParams.get('q')).toMatch(/, Bengaluru, India$/);
      expect((init?.headers as Record<string, string>)['user-agent']).toContain('Safeit');
      const hitBody = [{ lat: '12.93', lon: '77.62', display_name: 'Koramangala' }];
      return new Response(JSON.stringify(u.searchParams.get('q')!.startsWith('Koramangala') ? hitBody : []));
    });
    const cache = memCache();
    const n = createNominatim({ cache, fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    expect(await n.geocode('Koramangala', 'bengaluru')).toEqual({ lat: 12.93, lng: 77.62, display_name: 'Koramangala' });
    expect(await n.geocode('Nowhereville', 'bengaluru')).toBeNull();
    await n.geocode('koramangala ', 'bengaluru');
    await n.geocode('Nowhereville', 'bengaluru');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cache.store.get('bengaluru|nowhereville')).toEqual({ lat: null, lng: null, display_name: null });
  });

  it('does not cache HTTP errors', async () => {
    const cache = memCache();
    const n = createNominatim({ cache, fetchImpl: async () => new Response('busy', { status: 429 }), sleep: async () => {} });
    expect(await n.geocode('X place', 'goa')).toBeNull();
    expect(cache.store.size).toBe(0);
  });
});

describe('extractPlacePhrase', () => {
  it('finds a capitalised place after a preposition, skipping non-places', () => {
    expect(extractPlacePhrase('On Monday, a man was robbed near Silk Board Junction by two men.')).toBe('Silk Board Junction');
    expect(extractPlacePhrase('Police in Delhi said a woman in Mehrauli was attacked.')).toBe('Mehrauli');
    expect(extractPlacePhrase('no capitalised places here at all')).toBeNull();
  });
});
