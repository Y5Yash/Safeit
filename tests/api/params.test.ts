import { describe, expect, it } from 'vitest';
import { filterReports, parseCommon, type CommonParams } from '../../src/api/params.js';
import { CATEGORY_IDS } from '../../src/config/categories.js';
import { rep } from './fixtures.js';

const q = (s: string) => new URLSearchParams(s);
const today = new Date('2026-09-26T06:00:00Z');
const ok = (s: string): CommonParams => {
  const p = parseCommon(q(s), today);
  if ('error' in p) throw new Error(p.error);
  return p;
};

describe('parseCommon', () => {
  it('requires a valid city', () => {
    expect(parseCommon(q(''), today)).toEqual({ error: 'city must be one of delhi, bengaluru, goa' });
    expect(parseCommon(q('city=mumbai'), today)).toHaveProperty('error');
  });
  it('builds IST day boundaries', () => {
    const p = ok('city=delhi&from=2026-09-26&to=2026-09-26');
    expect(p.start.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    expect(p.end.toISOString()).toBe('2026-09-26T18:30:00.000Z');
  });
  it('uses the IST calendar day for today', () => {
    expect(parseCommon(q('city=goa'), new Date('2026-09-26T19:00:00Z'))).toMatchObject({ to: '2026-09-27' });
  });
  it('defaults to the full window, all categories and both sources', () => {
    const p = ok('city=goa');
    expect([p.from, p.to]).toEqual(['2026-03-26', '2026-09-26']);
    expect(p.categories).toEqual(CATEGORY_IDS);
    expect(p.sources).toEqual(['news', 'police']);
  });
  it('validates categories and sources lists', () => {
    expect(ok('city=goa&categories=murder,bogus, fraud').categories).toEqual(['murder', 'fraud']);
    expect(ok('city=goa&categories=bogus').categories).toEqual(CATEGORY_IDS);
    expect(ok('city=goa&sources=police').sources).toEqual(['police']);
    expect(parseCommon(q('city=goa&sources=review'), today)).toHaveProperty('error');
  });
  it('rejects malformed dates and inverted ranges', () => {
    expect(parseCommon(q('city=goa&from=26-09-2026'), today)).toHaveProperty('error');
    expect(parseCommon(q('city=goa&to=2026-13-45'), today)).toHaveProperty('error');
    expect(parseCommon(q('city=goa&from=2026-02-30'), today)).toHaveProperty('error');
    expect(parseCommon(q('city=goa&from=2026-09-26&to=2026-09-01'), today)).toHaveProperty('error');
  });
});

describe('filterReports', () => {
  it('filters by city, source, category and effective time', () => {
    const rows = [
      rep({ title: 'keep' }),
      rep({ city: 'goa' }),
      rep({ category: 'murder' }),
      rep({ source_type: 'police_fir_list', title: 'police' }),
      rep({ incident_datetime: '2026-08-01T10:00:00+05:30' }),
    ];
    const p = ok('city=delhi&from=2026-09-01&to=2026-09-30&categories=robbery');
    expect(filterReports(rows, p).map((r) => r.title)).toEqual(['keep', 'police']);
    const pol = ok('city=delhi&from=2026-09-01&to=2026-09-30&sources=police');
    expect(filterReports(rows, pol).map((r) => r.title)).toEqual(['police']);
  });
});
