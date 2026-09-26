import { describe, expect, it } from 'vitest';
import { CITY_CONFIG, inCity, isCity } from '../../src/config/cities.js';
import { WINDOW_DAYS, windowStart } from '../../src/config/window.js';
import { CATEGORY_IDS, classify, classifyRaw } from '../../src/config/categories.js';

describe('cities', () => {
  it('bbox membership', () => {
    expect(inCity('delhi', 28.5494, 77.2001)).toBe(true);
    expect(inCity('bengaluru', 12.9352, 77.6245)).toBe(true);
    expect(inCity('goa', 15.5439, 73.7553)).toBe(true);
    expect(inCity('bengaluru', 13.0976, 77.391)).toBe(false); // Nelamangala
    expect(inCity('bengaluru', 12.2958, 76.6394)).toBe(false); // Mysuru
    for (const [c, v] of Object.entries(CITY_CONFIG)) expect(inCity(c as 'goa', v.center.lat, v.center.lng)).toBe(true);
    expect(isCity('goa')).toBe(true);
    expect(isCity('mumbai')).toBe(false);
  });
});

describe('window', () => {
  it('is 184 days', () => {
    expect(WINDOW_DAYS).toBe(184);
    expect(windowStart(Date.parse('2026-09-26T00:00:00Z')).toISOString()).toBe('2026-03-26T00:00:00.000Z');
  });
});

describe('categories', () => {
  it.each([
    ['Man stabbed to death in Krishna Nagar, two held', 'murder'],
    ['Biker killed after truck rams two-wheeler on ORR', 'road_accident'],
    ['Woman molested in moving auto in Indiranagar', 'sexual_crime'],
    ['Techie loses Rs 1.2 crore to digital arrest scam', 'cyber_fraud'],
    ['Chain snatchers target elderly woman in Jayanagar', 'snatching'],
    ['Armed gang loots jewellery shop', 'robbery'],
    ['Youth shot at in Jahangirpuri', 'shooting'],
    ['Two injured after group attacks youths with rods', 'assault'],
    ['Gangster held for extortion calls to trader', 'extortion_organised_crime'],
    ['Builder cheated homebuyers of Rs 4 crore', 'fraud'],
    ['Ganja worth Rs 20 lakh seized', 'drugs'],
    ['Burglars break into locked house in Margao', 'burglary_theft'],
    ['Minor girl kidnapped from Anjuna beach shack', 'kidnapping'],
    ['Tourist drowns at Baga beach', 'drowning'],
    ['Student found dead in PG room', 'unnatural_death'],
    ['Portion of old building collapses in Chandni Chowk', 'public_safety'],
    ['Police conduct flag march ahead of festival', 'other'],
  ])('%s → %s', (t, c) => expect(classify(t)).toBe(c));
  it('exposes ids and raw phrase', () => {
    expect(CATEGORY_IDS).toContain('other');
    expect(classifyRaw('Chain snatchers target woman')).toBe('snatchers');
    expect(classifyRaw('flag march')).toBeNull();
  });
});
