import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowStart } from '../config/window.js';
import type { Report } from '../types.js';

const cache = new Map<string, Report[]>();

/** Reads the static reports file (cached per path). Missing file → []. Drops rows published before windowStart(). */
export function loadReports(path: string = join(process.cwd(), 'data', 'reports.json')): Report[] {
  const hit = cache.get(path);
  if (hit) return hit;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      cache.set(path, []);
      return [];
    }
    throw e;
  }
  const parsed = JSON.parse(raw) as unknown;
  const min = windowStart().getTime();
  const rows = (Array.isArray(parsed) ? (parsed as Report[]) : []).filter(
    (r) => Date.parse(r.published_datetime) >= min,
  );
  cache.set(path, rows);
  return rows;
}

export function resetStoreCache(): void {
  cache.clear();
}
