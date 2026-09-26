import { assignEvents } from '../extract/dedup.js';
import { prefilter } from '../extract/prefilter.js';
import { canonicalUrl } from '../http/url.js';
import type { Candidate, City, Report } from '../types.js';

export interface SelectStats {
  discovered: number;
  outOfWindow: number;
  undated: number;
  prefiltered: number;
  duplicates: number;
  existing: number;
  eligible: number;
}

/**
 * Discovery output → eligible candidates grouped by city: inside the window, prefiltered,
 * canonical URLs, deduplicated, and not already stored (`existing` holds canonical links).
 */
export function eligibleByCity(
  found: Candidate[],
  opts: { cutoff: Date; until?: Date; existing: Set<string> },
): { byCity: Map<City, Candidate[]>; stats: SelectStats } {
  const stats: SelectStats = { discovered: found.length, outOfWindow: 0, undated: 0, prefiltered: 0, duplicates: 0, existing: 0, eligible: 0 };
  const seen = new Set<string>();
  const byCity = new Map<City, Candidate[]>();
  for (const c of found) {
    if (!c.publishedAt || Number.isNaN(c.publishedAt.getTime())) { stats.undated++; continue; }
    if (c.publishedAt < opts.cutoff || (opts.until && c.publishedAt > opts.until)) { stats.outOfWindow++; continue; }
    let url: string;
    try { url = canonicalUrl(c.url); } catch { stats.prefiltered++; continue; }
    if (!prefilter({ title: c.title, url })) { stats.prefiltered++; continue; }
    if (seen.has(url)) { stats.duplicates++; continue; }
    seen.add(url);
    if (opts.existing.has(url)) { stats.existing++; continue; }
    stats.eligible++;
    const list = byCity.get(c.city) ?? [];
    list.push({ ...c, url });
    byCity.set(c.city, list);
  }
  return { byCity, stats };
}

/** Upsert `fresh` into `existing` by source_link, re-assign events over everything, newest first. */
export function mergeReports(existing: Report[], fresh: Report[]): Report[] {
  const byLink = new Map<string, Report>();
  for (const r of existing) byLink.set(r.source_link, r);
  for (const r of fresh) byLink.set(r.source_link, r);
  const all = [...byLink.values()].map((r) => ({ ...r, event_id: r.id }));
  return assignEvents(all).sort(
    (a, b) => Date.parse(b.published_datetime) - Date.parse(a.published_datetime) || (a.id < b.id ? -1 : 1),
  );
}
