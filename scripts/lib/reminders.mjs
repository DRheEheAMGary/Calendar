/**
 * reminders.mjs — turn the raw date list into the reports that the GitHub
 * Actions job prints and posts.
 *
 * One file builds every representation (JSON, workflow summary, issue body) so
 * the three can never disagree about what is due today.
 */

import { resolveAll, todayInZone } from './date-utils.mjs';

/** Human phrasing for a distance in days. */
export function relativeLabel(daysUntil) {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil < 0) return `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} ago`;
  return `in ${daysUntil} days`;
}

function describe(entry) {
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    nextDate: entry.nextDate,
    repeat: entry.repeat,
    daysUntil: entry.daysUntil,
    relative: relativeLabel(entry.daysUntil),
    /* `state` must travel with the entry: the page filters past one-offs out of
       the "upcoming" list with it, and styles today's rows with it. */
    state: entry.state,
    leadDays: entry.leadDays,
    note: entry.note,
    color: entry.color,
  };
}

/**
 * Build the full report for one run.
 * @param {object} options
 * @param {Array} options.entries   active entries from dates.json
 * @param {object} options.config   validated config.json
 * @param {string} [options.today]  override "today" (ISO); used by tests and --date
 * @param {Date}   [options.now]    instant to derive "today" from
 * @param {number} [options.upcomingDays] how far the projection reaches
 */
export function buildReport({ entries, config, today, now = new Date(), upcomingDays = 45 }) {
  const resolvedToday = today ?? todayInZone(config.timezone, now);
  const all = resolveAll(entries, resolvedToday, config);

  const dueToday = sortBySoonest(all.filter((entry) => entry.isToday)).map(describe);
  const inNoticeWindow = sortBySoonest(all.filter((entry) => entry.due && !entry.isToday)).map(describe);
  const upcoming = sortBySoonest(
    all.filter((entry) => entry.state !== 'past' && entry.daysUntil > 0 && entry.daysUntil <= upcomingDays),
  ).map(describe);
  const past = all.filter((entry) => entry.state === 'past').map(describe);

  return {
    generatedAt: now.toISOString(),
    timezone: config.timezone,
    today: resolvedToday,
    noticeLeadDays: config.noticeLeadDays,
    counts: {
      total: all.length,
      dueToday: dueToday.length,
      inNoticeWindow: inNoticeWindow.length,
      upcoming: upcoming.length,
      past: past.length,
    },
    dueToday,
    inNoticeWindow,
    upcoming,
    past,
    /** Everything inside the notice window, today first. */
    pending: sortBySoonest(all.filter((entry) => entry.due)).map(describe),
    /* Every entry including past ones, soonest first. The page uses `state` on
       these to decide what belongs in its "upcoming" list. */
    all: sortBySoonest(all).map(describe),
  };
}

/** Plain-text summary, used for the job log and $GITHUB_STEP_SUMMARY. */
export function formatSummary(report) {
  const lines = [
    `# Calendar reminder — ${report.today} (${report.timezone})`,
    '',
    `${report.counts.total} active date(s), ${report.counts.dueToday} on the day, ${report.counts.inNoticeWindow} inside the notice window.`,
    '',
  ];

  if (report.dueToday.length > 0) {
    lines.push('## Due today', '');
    for (const entry of report.dueToday) {
      lines.push(`- **${entry.title}** (\`${entry.nextDate}\`${entry.repeat === 'yearly' ? ', every year' : ''})`);
      if (entry.note) lines.push(`  - ${entry.note}`);
    }
    lines.push('');
  } else {
    lines.push(`## Nothing due today`, '');
  }

  if (report.inNoticeWindow.length > 0) {
    lines.push('## In the notice window', '');
    for (const entry of report.inNoticeWindow) {
      lines.push(`- ${entry.title} — ${entry.relative} (\`${entry.nextDate}\`)`);
    }
    lines.push('');
  }

  if (report.upcoming.length > 0) {
    lines.push('## Next up', '');
    for (const entry of report.upcoming.slice(0, 10)) {
      lines.push(`- \`${entry.nextDate}\` — ${entry.title} (${entry.relative})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The body of the reminder issue.
 * Checkboxes keep their state across runs: when the issue already exists, the
 * previous body's checked lines are merged back in, so ticking a reminder off
 * in the GitHub UI survives later scheduled runs.
 */
export function formatIssueBody(report, { previousBody = '' } = {}) {
  const previouslyChecked = new Set(
    previousBody
      .split('\n')
      .filter((line) => /^- \[[xX]\] /.test(line))
      .map((line) => line.replace(/^- \[[xX]\] /, '').trim()),
  );

  const lines = [
    `> Scheduled reminder for **${report.today}** · timezone \`${report.timezone}\` · generated ${report.generatedAt}`,
    '',
  ];

  if (report.dueToday.length > 0) {
    lines.push('## Due today', '');
    for (const entry of report.dueToday) {
      const repeatTag = entry.repeat === 'yearly' ? ' · every year' : '';
      const label = `**${entry.title}** (\`${entry.nextDate}\`${repeatTag})`;
      lines.push(`- [${previouslyChecked.has(label.trim()) ? 'x' : ' '}] ${label}`);
      if (entry.note) lines.push(`  - ${entry.note}`);
    }
    lines.push('');
  } else {
    lines.push('Nothing is due today.', '');
  }

  if (report.inNoticeWindow.length > 0) {
    lines.push('## Coming up soon', '');
    for (const entry of report.inNoticeWindow) {
      lines.push(`- ${entry.title} — ${entry.relative} (\`${entry.nextDate}\`)`);
    }
    lines.push('');
  }

  if (report.upcoming.length > 0) {
    lines.push('<details><summary>Next 10 dates</summary>', '');
    lines.push('| Date | Title | When |', '| --- | --- | --- |');
    for (const entry of report.upcoming.slice(0, 10)) {
      lines.push(`| \`${entry.nextDate}\` | ${entry.title} | ${entry.relative} |`);
    }
    lines.push('', '</details>', '');
  }

  lines.push(
    '---',
    '',
    `Maintained in [\`data/dates.json\`](../blob/HEAD/data/dates.json) · ` +
      'this issue is closed automatically on a day with nothing due.',
  );

  return lines.join('\n');
}

/** Title of the single rolling reminder issue. */
export function issueTitle(report) {
  return `📅 日历提醒 / Calendar reminder — ${report.today}`;
}

export const ISSUE_TITLE_PREFIX = '📅 日历提醒 / Calendar reminder — ';

/** Deterministic ordering: soonest first, title as the tie-break. */
export function sortBySoonest(entries) {
  return [...entries].sort(
    (a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title) || String(a.id).localeCompare(String(b.id)),
  );
}
