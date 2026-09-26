import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCsv, reviewRowToReport } from '../src/pipeline/reviews.js';
import { mergeReports } from '../src/pipeline/select.js';
import type { Report } from '../src/types.js';

// Usage: npm run merge:reviews -- [data/reviews/*.csv ...] [--out data/reports.json]
// With no files, every CSV in data/reviews/ is merged.
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'data/reports.json' } },
});
const outPath = values.out!;
const inputs = positionals.length
  ? positionals
  : existsSync('data/reviews')
    ? readdirSync('data/reviews').filter((f) => f.endsWith('.csv')).sort().map((f) => join('data/reviews', f))
    : [];
if (!inputs.length) throw new Error('no review CSVs found (pass paths or put them in data/reviews/)');

const existing: Report[] = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as Report[]) : [];
const skipped = new Map<string, number>();
const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
const rows: Report[] = [];

for (const file of inputs) {
  let n = 0;
  for (const row of parseCsv(readFileSync(file, 'utf8'))) {
    const res = reviewRowToReport(row);
    if (!res.ok) { skip(res.reason); continue; }
    rows.push(res.report);
    n++;
  }
  console.log(`${file}: ${n} rows`);
}

const before = new Set(existing.map((r) => r.source_link));
const merged = mergeReports(existing, rows);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(merged, null, 2)}\n`);

const inserted = rows.filter((r) => !before.has(r.source_link)).length;
console.log(`merged ${rows.length} review rows into ${outPath} (${inserted} new, ${rows.length - inserted} updated); total ${merged.length}`);
if (skipped.size) console.table(Object.fromEntries(skipped));
