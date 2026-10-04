#!/usr/bin/env node
/**
 * validate-dates.mjs — fail loudly when data/dates.json or data/config.json is
 * wrong. Runs first in both workflows, so a typo stops the pipeline before it
 * can post a confusing reminder issue.
 *
 * Usage: node scripts/validate-dates.mjs
 */

import path from 'node:path';
import { ROOT, loadProject } from './lib/config.mjs';
import { resolveAll, todayInZone } from './lib/date-utils.mjs';

function main() {
  let project;
  try {
    project = loadProject();
  } catch (error) {
    console.error(`\n✖ ${error.message}\n`);
    return 1;
  }

  const { config, entries, activeEntries } = project;
  const today = todayInZone(config.timezone);
  const resolved = resolveAll(activeEntries, today, config);
  const inactive = entries.length - activeEntries.length;

  const rel = (filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/');
  console.log(`✔ ${rel(project.configPath)} — timezone ${config.timezone}, noticeLeadDays ${config.noticeLeadDays}`);
  console.log(
    `✔ ${rel(project.datesPath)} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` +
      `${inactive > 0 ? ` (${inactive} inactive)` : ''}, ${resolved.filter((e) => e.state !== 'past').length} still ahead`,
  );

  const yearly = resolved.filter((entry) => entry.repeat === 'yearly').length;
  console.log(`  ${resolved.length - yearly} one-off, ${yearly} yearly · today is ${today} (${config.timezone})`);

  for (const entry of resolved.filter((item) => item.state !== 'past').slice(0, 5)) {
    const next = entry.daysUntil === 0 ? 'today' : `in ${entry.daysUntil} day(s)`;
    const repeat = entry.repeat === 'yearly' ? ' · yearly' : '';
    console.log(`  · ${entry.nextDate}  ${entry.title} — ${next}${repeat}`);
  }

  return 0;
}

process.exit(main());
