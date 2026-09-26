/** Locked product decision: only the last ~6 months of reports are collected and served. */
export const WINDOW_DAYS = 184;

export function windowStart(now: number = Date.now()): Date {
  return new Date(now - WINDOW_DAYS * 86_400_000);
}
