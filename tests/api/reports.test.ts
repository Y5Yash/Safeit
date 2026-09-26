import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { handleReports } from '../../src/api/reports.js';
import type { Report } from '../../src/types.js';
import { rep } from './fixtures.js';

const rows: Report[] = [1, 2, 3].map((i) =>
  rep({ title: `t${i}`, lat: 28.6, lng: 77.2, published_datetime: `2026-09-2${i}T10:00:00+05:30` }),
);
rows.push(rep({ title: 't4', lat: 28.8, lng: 77.0, published_datetime: '2026-09-10T10:00:00+05:30', incident_datetime: '2026-09-29T10:00:00+05:30' }));

async function get(qs: string) {
  const r = handleReports(new Request(`https://app/api/reports?city=delhi&from=2026-09-01&to=2026-09-30&${qs}`), rows);
  return { status: r.status, body: await r.json() };
}
const titles = (b: { reports: { title: string }[] }) => b.reports.map((r) => r.title);

describe('GET /api/reports', () => {
  it('returns newest first by effective time and paginates', async () => {
    const a = await get('limit=2');
    expect(a.body.total).toBe(4);
    expect(titles(a.body)).toEqual(['t4', 't3']);
    expect(titles((await get('limit=2&offset=2')).body)).toEqual(['t2', 't1']);
    expect(titles((await get('limit=2&offset=10')).body)).toEqual([]);
  });

  it('caps the limit and rejects bad paging', async () => {
    expect((await get('limit=999')).status).toBe(200);
    expect((await get('limit=abc')).status).toBe(400);
    expect((await get('offset=-1')).status).toBe(400);
  });

  it('filters by bbox', async () => {
    const r = await get('bbox=77.1,28.5,77.3,28.7');
    expect(r.body.total).toBe(3);
    expect((await get('bbox=1,2,3')).status).toBe(400);
    expect((await get('bbox=a,b,c,d')).status).toBe(400);
  });

  it('filters by h3 cell at that cell resolution', async () => {
    const r = await get(`h3=${latLngToCell(28.6, 77.2, 7)}`);
    expect(titles(r.body)).toEqual(['t3', 't2', 't1']);
    expect((await get(`h3=${latLngToCell(28.8, 77.0, 9)}`)).body.total).toBe(1);
    expect((await get('h3=nothex')).status).toBe(400);
  });

  it('applies categories and sources filters', async () => {
    expect((await get('categories=murder')).body.total).toBe(0);
    expect((await get('sources=police')).body.total).toBe(0);
    expect((await get('sources=news&categories=robbery')).body.total).toBe(4);
  });

  it('rejects a bad city', async () => {
    expect(handleReports(new Request('https://app/api/reports?city=x'), rows).status).toBe(400);
  });
});
