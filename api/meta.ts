import { handleMeta } from '../src/api/meta.js';
import { preflight } from '../src/api/http.js';
import { loadReports } from '../src/api/store.js';

export function GET(req: Request): Response {
  return handleMeta(req, loadReports());
}
export function OPTIONS(): Response {
  return preflight();
}
