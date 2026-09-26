// Thin client for the Safe-it backend. All functions return parsed JSON; they throw on HTTP errors.
export const API_BASE = new URLSearchParams(location.search).get('api') || 'https://safeit-backend.vercel.app';

async function get(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname} → HTTP ${res.status}`);
  return res.json();
}

/** { cities: [{id,name,center:{lat,lng},bbox:{minLat,maxLat,minLng,maxLng}}], categories: [{id,label}], sources, date_range } */
export const getMeta = () => get('/api/meta');

/** { city, from, to, res, total, max_count, cells: [{ h3, lat, lng, count, categories: {id: n} }] } */
export const getHeatmap = ({ city, from, to, categories, res = 8 }) =>
  get('/api/heatmap', { city, from, to, res, categories: categories?.join(',') });

/** All reports for the filters (pages through /api/reports, max 200 per page). Report fields: see README. */
export async function getAllReports({ city, from, to, categories }) {
  const out = [];
  for (let offset = 0; ; offset += 200) {
    const page = await get('/api/reports', { city, from, to, categories: categories?.join(','), limit: 200, offset });
    out.push(...page.reports);
    if (out.length >= page.total || page.reports.length === 0) return out;
  }
}
