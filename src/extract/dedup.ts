import type { Report } from '../types.js';

const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'of', 'for', 'to', 'by', 'with', 'from', 'and', 'or', 'after', 'over',
  'into', 'as', 'is', 'was', 'his', 'her', 'their', 'its', 'rs', 'lakh', 'crore', 'police', 'cops', 'delhi',
  'bengaluru', 'bangalore', 'goa', 'held', 'arrested', 'arrest', 'man', 'woman', 'case', 'booked', 'news',
]);

const IST_MS = 5.5 * 3_600_000;
const WINDOW_MS = 2 * 86_400_000;
const THRESHOLD = 0.5;

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map(stem),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** IST calendar day (YYYY-MM-DD) of an ISO timestamp, or null. */
function istDay(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}

/**
 * Groups reports describing the same incident and sets `event_id` to the id of the
 * earliest-published report in each group (tie → smallest id). Returns new objects, same order.
 */
export function assignEvents(reports: Report[]): Report[] {
  const n = reports.length;
  const info = reports.map((r) => ({
    pub: Date.parse(r.published_datetime),
    tokens: titleTokens(r.title),
    day: istDay(r.incident_datetime),
  }));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = reports[i];
      const b = reports[j];
      if (a.city !== b.city) continue;
      const ia = info[i];
      const ib = info[j];
      const byTitle = Math.abs(ia.pub - ib.pub) <= WINDOW_MS && jaccard(ia.tokens, ib.tokens) >= THRESHOLD;
      const byStation = a.police_station !== null && a.police_station === b.police_station
        && a.category === b.category && ia.day !== null && ia.day === ib.day;
      if (byTitle || byStation) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }

  const earlier = (i: number, j: number): boolean =>
    info[i].pub !== info[j].pub ? info[i].pub < info[j].pub : reports[i].id < reports[j].id;
  const leader = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const cur = leader.get(root);
    if (cur === undefined || earlier(i, cur)) leader.set(root, i);
  }
  return reports.map((r, i) => ({ ...r, event_id: reports[leader.get(find(i))!].id }));
}
