import { describe, expect, it } from 'vitest';
import { parseCsv, reviewCategory, reviewRowToReport, type ReviewRow } from '../../src/pipeline/reviews.js';

const NOW = Date.parse('2026-09-26T00:00:00Z');
const base: ReviewRow = {
  title: 'Tourist overcharged by fake guide',
  category: 'Scam',
  subcategory: 'TOURIST_SCAM',
  source_link: 'https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sABC',
  date_time: '2026-08-10T12:30:00Z',
  description: 'Reviewer alleges a fake guide demanded extra money near the market.',
  place_name: 'Palika Bazar',
  zone: 'Palika Bazaar',
  latitude: '28.6311207',
  longitude: '77.2190717',
  record_type: 'incident',
};

describe('reviewRowToReport', () => {
  it('maps a review incident to a Report', () => {
    const res = reviewRowToReport(base, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report).toMatchObject({
      city: 'delhi',
      category: 'fraud',
      category_raw: 'scam / tourist_scam',
      source_type: 'review',
      source_name: 'Google Maps reviews',
      source_link: base.source_link,
      incident_datetime: null,
      incident_datetime_precision: 'unknown',
      published_datetime: '2026-08-10T18:00:00+05:30',
      location_text: 'Palika Bazar, Palika Bazaar',
      lat: 28.6311207,
      lng: 77.2190717,
      geo_precision: 'address',
      police_station: null,
    });
    expect(res.report.id).toBe(res.report.event_id);
  });

  it('infers the city from coordinates', () => {
    const goa = reviewRowToReport({ ...base, latitude: '15.5439', longitude: '73.7553' }, NOW);
    const blr = reviewRowToReport({ ...base, latitude: '12.9767', longitude: '77.5713' }, NOW);
    expect(goa.ok && goa.report.city).toBe('goa');
    expect(blr.ok && blr.report.city).toBe('bengaluru');
  });

  it('skips rows outside the window, outside the cities, or without links', () => {
    expect(reviewRowToReport({ ...base, date_time: '2019-01-14T15:07:05Z' }, NOW)).toEqual({ ok: false, reason: 'older than the 6-month window' });
    expect(reviewRowToReport({ ...base, latitude: '19.07', longitude: '72.87' }, NOW)).toEqual({ ok: false, reason: 'out of area' });
    expect(reviewRowToReport({ ...base, source_link: '' }, NOW)).toEqual({ ok: false, reason: 'no source_link' });
    expect(reviewRowToReport({ ...base, record_type: 'zone_no_incidents' }, NOW)).toEqual({ ok: false, reason: 'not an incident row' });
  });
});

describe('reviewCategory', () => {
  it('prefers the subcategory, then the category, then the Safe-it classifier', () => {
    expect(reviewCategory({ category: 'Fraud', subcategory: 'UPI_FRAUD' })).toBe('cyber_fraud');
    expect(reviewCategory({ category: 'Crime', subcategory: 'PICKPOCKETING' })).toBe('burglary_theft');
    expect(reviewCategory({ category: 'Harassment', subcategory: 'OTHER' })).toBe('sexual_crime');
    expect(reviewCategory({ category: 'Crime', subcategory: 'OTHER_CRIME', title: 'Drug peddlers near the station' })).toBe('drugs');
    expect(reviewCategory({ category: 'Unsafe area' })).toBe('public_safety');
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and a BOM', () => {
    const csv = '﻿a,b,c\r\n1,"x, ""y""",3\r\n2,"line1\nline2",\r\n';
    expect(parseCsv(csv)).toEqual([
      { a: '1', b: 'x, "y"', c: '3' },
      { a: '2', b: 'line1\nline2', c: '' },
    ]);
  });
});
