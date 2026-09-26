/** Sorts by `time` ascending and picks `n` evenly spaced items (first and last included). All items if ≤ n. */
export function sampleEvenly<T>(items: T[], n: number, time: (t: T) => number): T[] {
  const sorted = [...items].sort((a, b) => time(a) - time(b));
  if (sorted.length <= n) return sorted;
  if (n <= 0) return [];
  if (n === 1) return [sorted[Math.floor((sorted.length - 1) / 2)]];
  const step = (sorted.length - 1) / (n - 1);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.round(i * step)]);
  return out;
}
