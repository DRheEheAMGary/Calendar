#!/usr/bin/env node
/**
 * generate-reminders.mjs — resolve every date against "today" and emit the run
 * report. This is the single source of truth for both the web build and the
 * issue the scheduled workflow posts.
 *
 * Usage:
 *   node scripts/generate-reminders.mjs                        # JSON to stdout
 *   node scripts/generate-reminders.mjs --out data/reminder.json
 *   node scripts/generate-reminders.mjs --date 2026-01-01      # rehearse a date
 *   node scripts/generate-reminders.mjs --summary              # human summary only
 *
 * Environment overrides (used by the workflows):
 *   TZ_OVERRIDE        IANA zone, replaces config.timezone
 *   NOTICE_LEAD_DAYS   integer, replaces config.noticeLeadDays
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, loadProject, parseArgs } from './lib/config.mjs';
import { assertTimezone, parseIso } from './lib/date-utils.mjs';
import { buildReport, formatSummary } from './lib/reminders.mjs';

function resolveNow(args) {
  if (typeof args.date === 'string') {
    parseIso(args.date); // throws on a malformed rehearsal date
    // Fixed instant at 04:00 UTC = 12:00 in Asia/Shanghai, so a --date run is
    // reproducible no matter when it is executed.
    return { now: new Date(`${args.date}T04:00:00Z`), today: args.date };
  }
  return { now: new Date(), today: undefined };
}

/**
 * Publish the run facts twice: as plain log lines a human can read, and as
 * `$GITHUB_OUTPUT` entries so later workflow steps can branch on them.
 */
function publishOutputs(report) {
  const facts = {
    today: report.today,
    due_today: String(report.counts.dueToday),
    in_window: String(report.counts.inNoticeWindow),
    upcoming: String(report.counts.upcoming),
    total: String(report.counts.total),
  };

  console.log(`REMINDER_TODAY=${facts.today}`);
  console.log(`REMINDER_DUE_TODAY=${facts.due_today}`);
  console.log(`REMINDER_IN_WINDOW=${facts.in_window}`);

  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  try {
    const lines = Object.entries(facts)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    appendFileSync(outputFile, `${lines}\n`, 'utf8');
  } catch (error) {
    console.error(`::warning::could not write GITHUB_OUTPUT — ${error.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let project;
  try {
    project = loadProject();
  } catch (error) {
    console.error(`\n✖ ${error.message}\n`);
    return 1;
  }

  const { config, activeEntries } = project;

  if (typeof process.env.TZ_OVERRIDE === 'string' && process.env.TZ_OVERRIDE.trim() !== '') {
    const zone = process.env.TZ_OVERRIDE.trim();
    assertTimezone(zone);
    config.timezone = zone;
  }
  if (typeof process.env.NOTICE_LEAD_DAYS === 'string' && process.env.NOTICE_LEAD_DAYS.trim() !== '') {
    const lead = Number(process.env.NOTICE_LEAD_DAYS);
    if (!Number.isInteger(lead) || lead < 0 || lead > 366) {
      console.error(`\n✖ NOTICE_LEAD_DAYS must be an integer between 0 and 366, received "${process.env.NOTICE_LEAD_DAYS}"\n`);
      return 1;
    }
    config.noticeLeadDays = lead;
  }

  const { now, today } = resolveNow(args);
  const report = buildReport({ entries: activeEntries, config, now, today });
  const json = `${JSON.stringify(report, null, 2)}\n`;

  if (args.out) {
    const target = path.resolve(ROOT, String(args.out));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, json, 'utf8');
    console.error(`✔ wrote ${path.relative(ROOT, target).replace(/\\/g, '/')}`);
  }

  if (args.summary) {
    process.stdout.write(`${formatSummary(report)}\n`);
  } else if (!args.out) {
    process.stdout.write(json);
  } else if (args['print-summary']) {
    process.stdout.write(`${formatSummary(report)}\n`);
  }

  publishOutputs(report);
  return 0;
}

process.exit(main());
