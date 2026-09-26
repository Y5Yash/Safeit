import { handleReports } from '../src/api/reports.js';
import { preflight } from '../src/api/http.js';
import { loadReports } from '../src/api/store.js';

export function GET(req: Request): Response {
  return handleReports(req, loadReports());
}
export function OPTIONS(): Response {
  return preflight();
}
