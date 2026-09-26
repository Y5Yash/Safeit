import { describe, expect, it } from 'vitest';
import { geocodePoliceReport, policeLocationInput, policeRowToReport, type PoliceRow } from '../../src/pipeline/police.js';
import type { LocationInput, Report } from '../../src/types.js';

const NOW = Date.parse('2026-09-26T12:00:00+05:30');

/** Shaped like merge_plan.md §2 (Delhi Police press release with a located incident). */
const delhiRow: PoliceRow = {
  event_id: '7f1c2a9e-0000-4000-8000-000000000001',
  city: 'delhi',
  title: 'Burglary at factory, Anand Parbat',
  category: 'burglary_theft',
  category_raw: 'HOUSE BREAKING',
  legal_sections: ['BNS 305(a)', 'BNS 331(4)'],
  source_link: 'https://delhipolice.gov.in/pressrelease?id=123',
  mentions: [{ source_name: 'Delhi Police', source_type: 'police_press_release', url: 'https://delhipolice.gov.in/pressrelease?id=123', published_at: '2026-09-10T18:00:00+05:30' }],
  source_type: 'police_press_release',
  incident_datetime: '2026-09-08T02:30:00+05:30',
  incident_datetime_precision: 'approx',
  published_datetime: '2026-09-10T18:00:00+05:30',
  fir_datetime: '2026-09-08T10:00:00+05:30',
  location_text: 'Industrial Area, H.No. 12/4 Anand Parbat',
  police_station: 'Anand Parbat',
  district: 'Central',
  lat: 28.6571,
  lng: 77.1728,
  geo_precision: 'district',
  description: 'Burglary at a factory; accused aged 24, s/o Mohan Lal, arrested. Stolen goods recovered.',
  status: 'arrested',
  fir_no: 'Anand Parbat/0456/2026',
  is_crime_incident: true,
  extraction_confidence: 0.9,
  victim_info: 'dropped',
};

/** Goa CCTNS FIR list row: no coordinates, non-taxonomy category, link only in mentions[]. */
const goaRow: PoliceRow = {
  city: 'goa',
  title: 'Two-wheeler lifted from parking, Mapusa',
  category: 'SNATCHER-CUM-AUTO LIFTER',
  category_raw: null,
  mentions: [{ source_name: 'Goa Police FIR list', source_type: 'police_fir_list', url: 'https://citizen.goapolice.gov.in/fir/list.pdf', published_at: '2026-08-02T09:00:00+05:30' }],
  incident_datetime: '2026-08-01',
  incident_datetime_precision: 'date',
  location_text: null,
  police_station: 'Mapusa',
  lat: null,
  lng: null,
  description: 'Motorcycle theft reported from a parking lot.',
  fir_no: 'MAP/123/2026',
  is_crime_incident: true,
};

describe('policeRowToReport', () => {
  it('maps a located press-release row, dropping PII and mapping enums', () => {
    const res = policeRowToReport(delhiRow, NOW);
    if (!res.ok) throw new Error(res.reason);
    const r = res.report;
    expect(res.needsGeo).toBe(false);
    expect(r.city).toBe('delhi');
    expect(r.category).toBe('burglary_theft');
    expect(r.category_raw).toBe('HOUSE BREAKING');
    expect(r.source_type).toBe('police_press_release');
    expect(r.source_name).toBe('Delhi Police');
    expect(r.source_link).toBe('https://delhipolice.gov.in/pressrelease?id=123#Anand%20Parbat%2F0456%2F2026');
    expect(r.id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.event_id).toBe(r.id);
    expect(r.incident_datetime).toBe('2026-09-08T02:30:00+05:30');
    expect(r.incident_datetime_precision).toBe('date');
    expect(r.published_datetime).toBe('2026-09-10T18:00:00+05:30');
    expect(r.geo_precision).toBe('city');
    expect([r.lat, r.lng]).toEqual([28.6571, 77.1728]);
    expect(r.police_station).toBe('Anand Parbat');
    expect(r.location_text).not.toMatch(/H\.No/);
    expect(r.description).not.toMatch(/aged|s\/o|Mohan/);
    expect(r).not.toHaveProperty('victim_info');
    expect(r).not.toHaveProperty('fir_no');
  });

  it('falls back to mentions[] and classifies non-taxonomy categories; flags missing coordinates', () => {
    const res = policeRowToReport(goaRow, NOW);
    if (!res.ok) throw new Error(res.reason);
    expect(res.needsGeo).toBe(true);
    expect(res.report.source_type).toBe('police_fir_list');
    expect(res.report.source_name).toBe('Goa Police FIR list');
    expect(res.report.source_link.startsWith('https://citizen.goapolice.gov.in/fir/list.pdf#')).toBe(true);
    expect(res.report.published_datetime).toBe('2026-08-02T09:00:00+05:30');
    expect(res.report.category).toBe('snatching');
    expect(res.report.incident_datetime_precision).toBe('date');
    expect(res.report.incident_datetime).toBe('2026-08-01T00:00:00+05:30');
  });

  it('gives different incidents on the same FIR-list page different links and ids', () => {
    const a = policeRowToReport(goaRow, NOW);
    const b = policeRowToReport({ ...goaRow, fir_no: 'MAP/124/2026' }, NOW);
    if (!a.ok || !b.ok) throw new Error('mapping failed');
    expect(a.report.source_link).not.toBe(b.report.source_link);
    expect(a.report.id).not.toBe(b.report.id);
  });

  it('skips non-incidents, rows older than the window, out-of-area points and rows without a link', () => {
    expect(policeRowToReport({ ...delhiRow, is_crime_incident: false }, NOW)).toMatchObject({ ok: false });
    expect(policeRowToReport({ ...delhiRow, published_datetime: '2026-01-01T00:00:00+05:30' }, NOW)).toMatchObject({ ok: false });
    expect(policeRowToReport({ ...delhiRow, lat: 12.97, lng: 77.59 }, NOW)).toMatchObject({ ok: false, reason: 'out of area' });
    expect(policeRowToReport({ ...goaRow, mentions: [] }, NOW)).toMatchObject({ ok: false });
    expect(policeRowToReport({ ...delhiRow, city: 'mumbai' }, NOW)).toMatchObject({ ok: false });
  });
});

describe('geocodePoliceReport', () => {
  const mapped = () => {
    const res = policeRowToReport(goaRow, NOW);
    if (!res.ok) throw new Error(res.reason);
    return res.report;
  };
  it('resolves using the police station and keeps the row values', async () => {
    let got: LocationInput | undefined;
    const r = (await geocodePoliceReport(mapped(), async (i) => {
      got = i;
      return { location_text: 'Mapusa', police_station: 'Mapusa', lat: 15.59, lng: 73.81, geo_precision: 'police_station', in_area: true };
    })) as Report;
    expect(got?.location_text).toBe('Mapusa police station');
    expect(r.geo_precision).toBe('police_station');
    expect([r.lat, r.lng]).toEqual([15.59, 73.81]);
    expect(r.location_text).toBe('Mapusa');
    expect(policeLocationInput(mapped()).text).toContain('Mapusa police station');
  });
  it('returns null when the location is out of area', async () => {
    expect(await geocodePoliceReport(mapped(), async () => ({
      location_text: 'Karwar', police_station: null, lat: 14.8, lng: 74.1, geo_precision: 'locality', in_area: false,
    }))).toBeNull();
  });
});
