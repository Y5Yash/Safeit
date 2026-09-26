const IST_OFFSET_MS = 330 * 60_000;

/** ISO-8601 string in IST, e.g. `2026-09-20T10:00:00+05:30`. */
export function toIstIso(d: Date): string {
  return `${new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}
