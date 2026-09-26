import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createResolver } from '../src/pipeline/deps.js';
import { geocodePoliceReport, policeRowToReport, type PoliceRow } from '../src/pipeline/police.js';
import { mergeReports } from '../src/pipeline/select.js';
import type { Report } from '../src/types.js';

// Usage: npm run merge:police -- <path/to/incidents.jsonl> [--out data/reports.json]
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'data/reports.json' } },
});
const input = positionals[0];
if (!input) throw new Error('usage: npm run merge:police -- <path/to/incidents.jsonl> [--out data/reports.json]');
const outPath = values.out!;

const existing: Report[] = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as Report[]) : [];
const { resolve, flush } = createResolver('data/geocode-cache.json');
const skipped = new Map<string, number>();
const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
const rows: Report[] = [];

const lines = readFileSync(input, 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  let row: PoliceRow;
  try { row = JSON.parse(line) as PoliceRow; } catch { skip('invalid JSON'); continue; }
  const res = policeRowToReport(row);
  if (!res.ok) { skip(res.reason); continue; }
  let report: Report | null = res.report;
  if (res.needsGeo) {
    try { report = await geocodePoliceReport(res.report, resolve); } catch (e) {
      skip('geocode error'); console.warn(`line ${i + 1}: ${(e as Error).message}`); continue;
    }
    if (!report) { skip('out of area'); continue; }
  }
  rows.push(report);
}

const before = new Set(existing.map((r) => r.source_link));
const merged = mergeReports(existing, rows);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(merged, null, 2)}\n`);
await flush();

const inserted = rows.filter((r) => !before.has(r.source_link)).length;
console.log(`merged ${rows.length} police rows into ${outPath} (${inserted} new, ${rows.length - inserted} updated); total ${merged.length}`);
if (skipped.size) console.table(Object.fromEntries(skipped));
