/**
 * publish-reminder-issue.mjs — post (or update, or close) the rolling reminder
 * issue that the scheduled workflow is really about.
 *
 * Behaviour, per run:
 *   • any open reminder issue whose title is not today's is closed first, so the
 *     open-issue list always shows exactly one reminder: today's, or none;
 *   • if something is due today, a new issue is created or today's is updated;
 *   • checkboxes already ticked in the previous body are carried over, so a
 *     reminder you marked done in the GitHub UI stays ticked on later runs;
 *   • if nothing is due, no issue is opened — and any earlier one is closed.
 *
 * Usage:
 *   node scripts/publish-reminder-issue.mjs [--data data/reminder.json] [--dry-run]
 *
 * Required environment:
 *   GH_TOKEN or GITHUB_TOKEN   token with issues:write
 *   GITHUB_REPOSITORY          "owner/name"
 * Optional:
 *   GITHUB_API_URL             API origin, for GitHub Enterprise
 *   GITHUB_STEP_SUMMARY        file to append the run summary to
 *   GITHUB_OUTPUT              file to append step outputs to
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, parseArgs } from './lib/config.mjs';
import { createGitHubClient } from './lib/github.mjs';
import { ISSUE_TITLE_PREFIX, formatIssueBody, formatSummary, issueTitle } from './lib/reminders.mjs';

const LABEL = 'calendar-reminder';

function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`${path.relative(ROOT, filePath)} is missing. Run scripts/generate-reminders.mjs first.`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function appendTo(filePath, contents, what) {
  if (!filePath) return;
  try {
    appendFileSync(filePath, contents, 'utf8');
  } catch (error) {
    console.error(`::warning::could not write the ${what} — ${error.message}`);
  }
}

/** Is this open issue one of ours, for a different day? */
function isStaleReminder(issue, today) {
  return issue.state === 'open' && issue.title.startsWith(ISSUE_TITLE_PREFIX) && issue.title !== issueTitle({ today });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run']);
  const dataPath = path.resolve(ROOT, String(args.data ?? path.join(ROOT, 'data', 'reminder.json')));

  const report = readJson(dataPath);
  const summary = formatSummary(report);
  process.stdout.write(`${summary}\n`);

  const dueCount = report.counts.dueToday;

  if (dryRun) {
    console.log(`\nDRY RUN — would ${dueCount > 0 ? 'open/update' : 'close'} the reminder issue for ${report.today}.`);
    appendTo(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n_Dry run: no issue was touched._\n`, 'step summary');
    return 0;
  }

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('\n✖ no GH_TOKEN / GITHUB_TOKEN in the environment; nothing to publish.');
    console.error('  Run with --dry-run to preview without a token.\n');
    return 1;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    console.error('\n✖ GITHUB_REPOSITORY is not set (expected "owner/name").\n');
    return 1;
  }

  const github = createGitHubClient({
    token,
    repository,
    apiBase: process.env.GITHUB_API_URL || 'https://api.github.com',
  });

  const title = issueTitle(report);
  const existing = await github.listIssuesByLabel(LABEL);
  const todayIssue = existing.find((issue) => issue.title === title) ?? null;
  const actions = [];

  // Close earlier reminders first, so at most one is ever open.
  for (const issue of existing.filter((candidate) => isStaleReminder(candidate, report.today))) {
    await github.closeIssue(issue.number);
    actions.push(`closed #${issue.number} (${issue.title.replace(ISSUE_TITLE_PREFIX, '')})`);
  }

  if (dueCount === 0) {
    if (todayIssue && todayIssue.state === 'open') {
      await github.closeIssue(todayIssue.number);
      actions.push(`closed #${todayIssue.number} — nothing due today`);
      if (!String(todayIssue.body ?? '').includes('Nothing is due today')) {
        await github.addComment(todayIssue.number, `No dates are due on ${report.today}; closing this reminder.`);
      }
    } else {
      actions.push('nothing due today — no issue opened');
    }
  } else {
    const body = formatIssueBody(report, { previousBody: todayIssue?.body ?? '' });

    if (todayIssue) {
      if (todayIssue.state === 'closed') {
        await github.reopenIssue(todayIssue.number);
        actions.push(`reopened #${todayIssue.number}`);
      }
      await github.updateIssue(todayIssue.number, { title, body });
      actions.push(`updated #${todayIssue.number} — ${dueCount} due today`);
    } else {
      const created = await github.createIssue({ title, body, labels: [LABEL] });
      actions.push(`opened #${created.number} — ${dueCount} due today`);
    }
  }

  const bulletList = actions.map((action) => `- ${action}`).join('\n');
  console.log(`\n${bulletList}`);

  appendTo(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\n### Actions\n\n${bulletList}\n`, 'step summary');
  appendTo(process.env.GITHUB_OUTPUT, `due_today=${dueCount}\n`, 'step output');

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n✖ ${error.message}\n`);
    if (error.body) console.error(JSON.stringify(error.body, null, 2));
    process.exit(1);
  },
);
