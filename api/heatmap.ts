import { handleHeatmap } from '../src/api/heatmap.js';
import { preflight } from '../src/api/http.js';
import { loadReports } from '../src/api/store.js';

export function GET(req: Request): Response {
  return handleHeatmap(req, loadReports());
}
export function OPTIONS(): Response {
  return preflight();
}
