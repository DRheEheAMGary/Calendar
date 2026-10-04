#!/usr/bin/env node
/**
 * build-web.mjs — assemble the static site into `dist/`.
 *
 * GitHub Pages serves the artifact produced by the deploy workflow, so the page
 * cannot read `../data/dates.json` from the repository root. This script copies
 * the files the browser needs and emits a normalized `dist/data/dates.json`
 * carrying both the date list and the precomputed reminder projection.
 *
 * Usage:
 *   node scripts/build-web.mjs                 # build (reminder data optional)
 *   node scripts/build-web.mjs --strict        # fail when data/reminder.json is missing
 *   node scripts/build-web.mjs --out dist --reminder data/reminder.json
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadProject, parseArgs } from './lib/config.mjs';

const WEB_SOURCE = path.join(ROOT, 'web');
const DEFAULT_OUT = path.join(ROOT, 'dist');
const DEFAULT_REMINDER = path.join(ROOT, 'data', 'reminder.json');

function readJsonIfPresent(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)} is not valid JSON — ${error.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, String(args.out ?? DEFAULT_OUT));
  const reminderPath = path.resolve(ROOT, String(args.reminder ?? DEFAULT_REMINDER));

  if (outDir === ROOT || outDir === WEB_SOURCE) {
    console.error(`✖ refusing to build into ${outDir}`);
    return 1;
  }

  let project;
  try {
    project = loadProject();
  } catch (error) {
    console.error(`\n✖ ${error.message}\n`);
    return 1;
  }

  const reminder = readJsonIfPresent(reminderPath);
  if (!reminder && args.strict) {
    console.error(`\n✖ ${path.relative(ROOT, reminderPath)} is missing (required by --strict).`);
    console.error('  Run: node scripts/generate-reminders.mjs --out data/reminder.json\n');
    return 1;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'data'), { recursive: true });
  cpSync(WEB_SOURCE, outDir, { recursive: true });

  const payload = {
    generated: (reminder?.generatedAt ?? new Date().toISOString()),
    timezone: project.config.timezone,
    noticeLeadDays: project.config.noticeLeadDays,
    dates: project.entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      title: entry.title,
      repeat: entry.repeat,
      leadDays: entry.leadDays,
      note: entry.note,
      color: entry.color,
      active: entry.active,
    })),
    reminder,
  };

  const target = path.join(outDir, 'data', 'dates.json');
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  // Keep GitHub Pages from running the output through Jekyll.
  writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');

  const rel = (filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/');
  console.log(`✔ built ${rel(outDir)} from ${rel(WEB_SOURCE)}`);
  console.log(`  ${payload.dates.length} date(s), reminder projection ${reminder ? 'included' : 'MISSING (fallback rendering)'}`);
  console.log(`  wrote ${rel(target)}`);
  return 0;
}

process.exit(main());
