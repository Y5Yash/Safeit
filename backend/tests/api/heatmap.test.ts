import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { handleHeatmap } from '../../src/api/heatmap.js';
import type { Report } from '../../src/types.js';
import { rep } from './fixtures.js';

async function get(reports: Report[], qs: string) {
  const r = handleHeatmap(new Request(`https://app/api/heatmap?${qs}`), reports);
  return { status: r.status, body: await r.json() };
}
const SEPT = 'city=delhi&from=2026-09-01&to=2026-09-30';

describe('GET /api/heatmap', () => {
  it('never plots city-precision rows', async () => {
    const { body } = await get([rep({ geo_precision: 'city', lat: 28.6139, lng: 77.209 }), rep()], SEPT);
    expect(body.total).toBe(1);
    expect(body.cells).toHaveLength(1);
    expect(body.cells[0].h3).toBe(latLngToCell(28.6015, 77.2015, 8));
  });

  it('respects IST day boundaries', async () => {
    const rows = [
      rep({ published_datetime: '2026-09-26T00:30:00+05:30' }),
      rep({ published_datetime: '2026-09-25T23:30:00+05:30' }),
    ];
    expect((await get(rows, 'city=delhi&from=2026-09-26&to=2026-09-26')).body.total).toBe(1);
  });

  it('uses incident time over published time', async () => {
    const rows = [rep({ incident_datetime: '2026-08-01T10:00:00+05:30', incident_datetime_precision: 'date' })];
    expect((await get(rows, SEPT)).body.total).toBe(0);
    expect((await get(rows, 'city=delhi&from=2026-08-01&to=2026-08-01')).body.total).toBe(1);
  });

  it('counts an event once, preferring the police representative', async () => {
    const rows = [
      rep({ event_id: 'E', category: 'robbery', lat: 28.7, lng: 77.1, geo_precision: 'address' }),
      rep({ event_id: 'E', category: 'murder', source_type: 'police_press_release', lat: 28.6015, lng: 77.2015 }),
      rep({ event_id: 'E', category: 'robbery', geo_precision: 'locality', published_datetime: '2026-09-19T10:00:00+05:30' }),
    ];
    const { body } = await get(rows, SEPT);
    expect(body).toMatchObject({ total: 1, max_count: 1 });
    expect(body.cells[0]).toMatchObject({ h3: latLngToCell(28.6015, 77.2015, 8), count: 1, categories: { murder: 1 } });
  });

  it('prefers the best geo precision, then earliest published', async () => {
    const rows = [
      rep({ event_id: 'E', geo_precision: 'locality', lat: 28.7, lng: 77.1 }),
      rep({ event_id: 'E', geo_precision: 'police_station', lat: 28.6015, lng: 77.2015, published_datetime: '2026-09-21T10:00:00+05:30' }),
      rep({ event_id: 'E', geo_precision: 'police_station', lat: 28.55, lng: 77.25, published_datetime: '2026-09-22T10:00:00+05:30' }),
    ];
    const { body } = await get(rows, SEPT);
    expect(body.cells).toHaveLength(1);
    expect(body.cells[0].h3).toBe(latLngToCell(28.6015, 77.2015, 8));
  });

  it('aggregates cells with category counts, sorted by count', async () => {
    const rows = [
      rep({ lat: 28.7, lng: 77.1 }),
      rep(), rep({ category: 'murder' }), rep(),
    ];
    const { body } = await get(rows, `${SEPT}&res=7`);
    expect(body).toMatchObject({ city: 'delhi', from: '2026-09-01', to: '2026-09-30', res: 7, total: 4, max_count: 3 });
    expect(body.cells).toHaveLength(2);
    expect(body.cells[0]).toMatchObject({ h3: latLngToCell(28.6015, 77.2015, 7), count: 3, categories: { robbery: 2, murder: 1 } });
    expect(typeof body.cells[0].lat).toBe('number');
    expect(body.cells[1].count).toBe(1);
  });

  it('applies categories and sources filters', async () => {
    const rows = [rep(), rep({ category: 'murder' }), rep({ source_type: 'police_fir_list', category: 'murder' })];
    expect((await get(rows, `${SEPT}&categories=murder`)).body.total).toBe(2);
    expect((await get(rows, `${SEPT}&sources=news`)).body.total).toBe(2);
    expect((await get(rows, `${SEPT}&sources=police&categories=robbery`)).body.total).toBe(0);
  });

  it('rejects bad params', async () => {
    expect((await get([], 'city=paris')).status).toBe(400);
    expect((await get([], 'city=delhi&res=4')).status).toBe(400);
    expect((await get([], 'city=delhi&res=11')).status).toBe(400);
    expect((await get([], 'city=delhi&res=7.5')).status).toBe(400);
    expect((await get([], 'city=delhi&from=2026-9-1')).status).toBe(400);
  });

  it('sets CORS headers', () => {
    const r = handleHeatmap(new Request('https://app/api/heatmap?city=delhi'), []);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});
