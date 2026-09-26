import { describe, expect, it } from 'vitest';
import { buildMatcher, matchLocation } from '../../src/geo/matcher.js';
import { normalizeName } from '../../src/geo/normalize.js';
import type { GazetteerEntry } from '../../src/types.js';

const E: GazetteerEntry[] = [
  { name: 'Hauz Khas', kind: 'locality', lat: 28.5494, lng: 77.2001 },
  { name: 'Hauz Khas Police Station', kind: 'police_station', lat: 28.545, lng: 77.205 },
  { name: 'Krishna Nagar', kind: 'locality', lat: 28.656, lng: 77.28 },
  { name: 'Shahdara', kind: 'locality', lat: 28.673, lng: 77.289 },
  { name: 'Nagar', kind: 'locality', lat: 1, lng: 1 },
  { name: 'Delhi', kind: 'locality', lat: 2, lng: 2 },
];
const m = buildMatcher(E, 'delhi');
const input = (title: string, text = '', keywords: string[] = []) => ({ title, text, keywords });

describe('normalizeName', () => {
  it('strips police-station suffixes, punctuation and case', () => {
    expect(normalizeName('Hauz Khas Police Station')).toBe('hauz khas');
    expect(normalizeName('P.S. Shahdara')).toBe('shahdara');
    expect(normalizeName('Krishna-Nagar  PS')).toBe('krishna nagar');
  });
});

describe('matchLocation', () => {
  it('prefers an explicit police station mention', () => {
    expect(matchLocation(m, input('Man robbed', 'A case was registered at Hauz Khas police station.')))
      .toEqual({ text: 'Hauz Khas Police Station', lat: 28.545, lng: 77.205, precision: 'police_station' });
  });
  it('matches the longest locality in the title first', () => {
    expect(matchLocation(m, input('Robbery in Krishna Nagar, Shahdara'))?.text).toBe('Krishna Nagar');
  });
  it('falls back to keywords, then body text', () => {
    expect(matchLocation(m, input('Man robbed', '', ['Shahdara robbery']))?.text).toBe('Shahdara');
    expect(matchLocation(m, input('Man robbed', 'The victim lives in Shahdara.'))?.text).toBe('Shahdara');
  });
  it('ignores stoplisted/city names and partial words', () => {
    expect(matchLocation(m, input('Delhi: man robbed in some nagar'))).toBeNull();
    expect(matchLocation(m, input('Shahdaraabad incident'))).toBeNull();
  });
});
