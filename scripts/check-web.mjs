#!/usr/bin/env node
/**
 * check-web.mjs — post-build sanity check on `dist/`.
 *
 * This exists because the failure mode is silent: Pages will happily serve a
 * page whose script 404s or whose data file never shipped, and the only symptom
 * is a blank calendar. Every check here maps to something that actually broke
 * during development.
 *
 * Usage: node scripts/check-web.mjs [--dir dist]
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from './lib/config.mjs';

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function ok(message) {
  notes.push(message);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(ROOT, String(args.dir ?? path.join(ROOT, 'dist')));

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`\n✖ ${path.relative(ROOT, dir)} does not exist. Run: npm run build\n`);
    return 1;
  }

  // 1. Required files.
  for (const relative of ['index.html', 'styles.css', 'app.js', 'data/dates.json', '.nojekyll']) {
    if (!existsSync(path.join(dir, relative))) fail(`missing file: ${relative}`);
  }

  const html = existsSync(path.join(dir, 'index.html')) ? readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  const css = existsSync(path.join(dir, 'styles.css')) ? readFileSync(path.join(dir, 'styles.css'), 'utf8') : '';
  const js = existsSync(path.join(dir, 'app.js')) ? readFileSync(path.join(dir, 'app.js'), 'utf8') : '';

  // 2. The HTML must load its two local assets, with paths that work from a
  //    project Pages URL such as https://user.github.io/Calendar/.
  if (html && !html.includes('href="./styles.css"')) fail('index.html does not link ./styles.css');
  if (html && !html.includes('src="./app.js"')) fail('index.html does not load ./app.js');
  if (html && /(?:href|src)="\/(?!\/)/.test(html)) {
    fail('index.html contains a root-absolute (leading "/") asset path, which breaks project Pages URLs');
  }

  // 3. Every element id the script looks up must exist in the markup. A typo
  //    here throws at the first render and leaves the page blank.
  const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  const missingIds = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  if (missingIds.length > 0) fail(`app.js references id(s) absent from index.html: ${missingIds.join(', ')}`);
  if (ids.length > 0) ok(`${new Set(ids).size} element id(s) resolved against index.html`);

  // 4. Classes the script toggles must have a rule, otherwise markers are invisible.
  for (const className of ['day--marked', 'day--today', 'day--past', 'event-item--today', 'tag--today']) {
    if (!css.includes(`.${className}`)) fail(`styles.css has no rule for .${className}, which app.js applies`);
  }

  // 5. The data payload must be shaped the way the script reads it.
  const dataPath = path.join(dir, 'data', 'dates.json');
  if (existsSync(dataPath)) {
    try {
      const payload = JSON.parse(readFileSync(dataPath, 'utf8'));
      if (!Array.isArray(payload.dates)) fail('data/dates.json has no "dates" array');
      if (typeof payload.timezone !== 'string') fail('data/dates.json has no "timezone"');
      if (!payload.reminder) {
        notes.push('data/dates.json has no reminder projection — the page will compute dates itself');
      }
      for (const [index, entry] of (payload.dates ?? []).entries()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? '')) fail(`data/dates.json[${index}] has an invalid date`);
        if (!entry.title) fail(`data/dates.json[${index}] has no title`);
      }
      ok(`${(payload.dates ?? []).length} date(s) in the payload`);
    } catch (error) {
      fail(`data/dates.json is not valid JSON — ${error.message}`);
    }
  }

  // 6. A yearly entry without an id cannot survive a title change; the validator
  //    catches this too, but the built artifact is what actually ships.
  if (!js.includes('nextYearly')) fail('app.js no longer contains the yearly-occurrence fallback');

  const rel = path.relative(ROOT, dir).replace(/\\/g, '/');
  if (problems.length > 0) {
    console.error(`\n✖ ${rel} failed ${problems.length} check(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    return 1;
  }

  console.log(`✔ ${rel} looks deployable`);
  for (const note of notes) console.log(`  · ${note}`);
  return 0;
}

process.exit(main());
