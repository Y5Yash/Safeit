import { describe, expect, it } from 'vitest';
import { GAZETTEER } from '../../src/geo/gazetteer-data/index.js';
import { buildMatcher, matchLocation } from '../../src/geo/matcher.js';
import { inCity } from '../../src/config/cities.js';

describe('seeded gazetteer', () => {
  it('has police stations and localities inside each city', () => {
    for (const [city, entries] of Object.entries(GAZETTEER)) {
      expect(entries.length).toBeGreaterThan(300);
      expect(entries.filter((e) => e.kind === 'police_station').length).toBeGreaterThan(10);
      // `out center` can place a boundary-crossing way's centre just outside the bbox; allow a sliver.
      expect(entries.filter((e) => inCity(city as 'goa', e.lat, e.lng)).length / entries.length).toBeGreaterThan(0.98);
    }
  });
  it('resolves well-known places', () => {
    const t = (city: 'delhi' | 'bengaluru' | 'goa', title: string) =>
      matchLocation(buildMatcher(GAZETTEER[city], city), { title, keywords: [], text: '' });
    expect(t('delhi', 'Robbery in Hauz Khas')).not.toBeNull();
    expect(t('bengaluru', 'Chain snatching in Koramangala')).not.toBeNull();
    expect(t('goa', 'Tourist assaulted in Calangute')).not.toBeNull();
  });
});
