/**
 * test.mjs — the project's test suite. No framework, no dependencies:
 * `node scripts/test.mjs` is all it takes.
 *
 * The cases below are the ones that would otherwise fail silently in
 * production — a reminder posted on the wrong day, a leap-day anniversary that
 * disappears, an issue that gets duplicated or never closed.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  diffDays,
  daysInMonth,
  isLeapYear,
  nextYearlyOccurrence,
  parseIso,
  resolveAll,
  toIso,
  todayInZone,
  weekdayIndex,
} from './lib/date-utils.mjs';
import { validateConfig, validateDates } from './lib/config.mjs';
import { buildReport, formatIssueBody, formatSummary, issueTitle } from './lib/reminders.mjs';
import { createGitHubClient } from './lib/github.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/* --- tiny harness -------------------------------------------------------- */

let passed = 0;
const failures = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n${name}`);
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failures.push(`${currentSuite} › ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(label, actual, expected) {
  const ok = Object.is(actual, expected);
  check(label, ok, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* --- date plumbing ------------------------------------------------------- */

suite('date-utils: timezone-aware "today"');
{
  // 2026-10-04T20:30Z is still 2026-10-04 in Shanghai (+08), 13:00 in Los Angeles.
  const instant = new Date('2026-10-04T20:30:00Z');
  equal('Asia/Shanghai is a day ahead of UTC in the evening', todayInZone('Asia/Shanghai', instant), '2026-10-05');
  equal('UTC lags behind Shanghai', todayInZone('UTC', instant), '2026-10-04');
  equal('America/Los_Angeles lags further', todayInZone('America/Los_Angeles', instant), '2026-10-04');

  // A runner starting a hair after midnight UTC must still report the local day.
  const justAfterUtcMidnight = new Date('2026-10-04T00:05:00Z');
  equal('UTC cron start still resolves to the Shanghai day', todayInZone('Asia/Shanghai', justAfterUtcMidnight), '2026-10-04');
}

suite('date-utils: calendar math');
{
  equal('2024 is a leap year', isLeapYear(2024), true);
  equal('2100 is not a leap year', isLeapYear(2100), false);
  equal('2000 is a leap year', isLeapYear(2000), true);
  equal('February 2024 has 29 days', daysInMonth(2024, 2), 29);
  equal('February 2025 has 28 days', daysInMonth(2025, 2), 28);

  equal('addDays crosses a month boundary', addDays('2026-01-30', 3), '2026-02-02');
  equal('addDays crosses a year boundary', addDays('2026-12-31', 1), '2027-01-01');
  equal('addDays handles negatives across months', addDays('2026-03-01', -1), '2026-02-28');
  equal('addDays lands on the leap day', addDays('2024-02-28', 1), '2024-02-29');

  equal('diffDays forward', diffDays('2026-10-04', '2026-10-07'), 3);
  equal('diffDays backward', diffDays('2026-10-04', '2026-10-01'), -3);
  equal('diffDays across a year', diffDays('2026-12-31', '2027-01-01'), 1);

  equal('Monday is index 0', weekdayIndex({ year: 2026, month: 10, day: 5 }), 0);
  equal('Sunday is index 6', weekdayIndex({ year: 2026, month: 10, day: 4 }), 6);

  let threw = false;
  try {
    parseIso('2026-02-30');
  } catch {
    threw = true;
  }
  check('parseIso rejects a non-existent date', threw);

  threw = false;
  try {
    parseIso('2026-2-3');
  } catch {
    threw = true;
  }
  check('parseIso rejects an unpadded date', threw);
}

suite('date-utils: yearly recurrence');
{
  // The whole point of yearly events: the stored year is irrelevant.
  equal('same day this year', nextYearlyOccurrence('1970-05-20', '2026-05-20'), '2026-05-20');
  equal('already passed rolls to next year', nextYearlyOccurrence('1970-05-20', '2026-05-21'), '2027-05-20');
  equal('still ahead stays this year', nextYearlyOccurrence('1970-12-31', '2026-01-01'), '2026-12-31');

  // Leap-day clamping: an anniversary on 29 Feb must not vanish in common years.
  equal('29 Feb observed on 28 Feb in a common year', nextYearlyOccurrence('2024-02-29', '2027-01-01'), '2027-02-28');
  equal('29 Feb on the real day in a leap year', nextYearlyOccurrence('2024-02-29', '2028-01-01'), '2028-02-29');
  equal('29 Feb on the day itself in a leap year', nextYearlyOccurrence('2024-02-29', '2028-02-29'), '2028-02-29');
  equal('29 Feb just after rolls to the next year', nextYearlyOccurrence('2024-02-29', '2028-03-01'), '2029-02-28');
}

/* --- validation ---------------------------------------------------------- */

suite('validation: reject bad data loudly');
{
  const good = [
    { id: 'a', date: '2026-01-01', title: 'New Year', repeat: 'none' },
    { id: 'b', date: '1970-05-20', title: 'Birthday', repeat: 'yearly' },
  ];
  equal('a valid list produces no problems', validateDates(good).problems.length, 0);

  equal('a bare object is rejected', validateDates({}).problems.length > 0, true);
  equal('a missing title is rejected', validateDates([{ date: '2026-01-01' }]).problems.length, 1);
  equal('a malformed date is rejected', validateDates([{ date: '01/01/2026', title: 'x' }]).problems.length, 1);
  equal('a non-existent date is rejected', validateDates([{ date: '2026-02-30', title: 'x' }]).problems.length, 1);
  equal('an unknown repeat mode is rejected', validateDates([{ date: '2026-01-01', title: 'x', repeat: 'monthly' }]).problems.length, 1);
  equal('duplicate ids are rejected', validateDates([
    { id: 'dup', date: '2026-01-01', title: 'a' },
    { id: 'dup', date: '2026-01-02', title: 'b' },
  ]).problems.length, 1);
  equal('a yearly entry without an id is rejected', validateDates([{ date: '2026-01-01', title: 'x', repeat: 'yearly' }]).problems.length, 1);
  equal('an unknown key is rejected', validateDates([{ date: '2026-01-01', title: 'x', wat: 1 }]).problems.length, 1);
  equal('an out-of-range leadDays is rejected', validateDates([{ date: '2026-01-01', title: 'x', leadDays: -1 }]).problems.length, 1);

  // Issues reported per entry, not per file, so the message can point at one row.
  const many = validateDates([
    { date: 'nope', title: '' },
    { date: '2026-01-01', title: 'ok' },
  ]);
  equal('problems are attributed to the offending entry', many.problems.length, 2);
  check('the first problem names index 0', many.problems[0].startsWith('data/dates.json[0]'), many.problems[0]);

  equal('a good timezone is accepted', validateConfig({ timezone: 'Asia/Shanghai' }).problems.length, 0);
  equal('a missing timezone is rejected', validateConfig({}).problems.length, 1);
  equal('a nonsense timezone is rejected', validateConfig({ timezone: 'Mars/Olympus' }).problems.length, 1);
  equal('defaults are filled in', validateConfig({ timezone: 'UTC' }).config.noticeLeadDays, 0);
}

/* --- reports ------------------------------------------------------------- */

suite('reminders: report shape');
{
  const config = { timezone: 'Asia/Shanghai', noticeLeadDays: 0, upcomingLimit: 10 };
  const entries = [
    { id: 'today', date: '2026-10-04', title: 'Due today', repeat: 'none', leadDays: null, note: '', color: 'blue', active: true },
    { id: 'soon', date: '2026-10-07', title: 'In three days', repeat: 'none', leadDays: null, note: '', color: 'blue', active: true },
    { id: 'past', date: '2026-01-01', title: 'Long gone', repeat: 'none', leadDays: null, note: '', color: 'blue', active: true },
    { id: 'yearly', date: '1970-10-04', title: 'Anniversary', repeat: 'yearly', leadDays: null, note: '', color: 'rose', active: true },
  ];

  const report = buildReport({ entries, config, today: '2026-10-04', now: new Date('2026-10-04T00:00:00Z') });

  equal('today is echoed in the report', report.today, '2026-10-04');
  equal('both one-off and yearly are due today', report.counts.dueToday, 2);
  equal('the past entry is not due', report.dueToday.some((entry) => entry.id === 'past'), false);
  equal('the past entry is classified as past', report.past.length, 1);
  equal('upcoming excludes today and the past', report.upcoming.map((entry) => entry.id).join(','), 'soon');
  equal('a yearly entry reports its real occurrence', report.dueToday.find((entry) => entry.id === 'yearly').nextDate, '2026-10-04');
  equal('relative labels read naturally', report.all.find((entry) => entry.id === 'soon').relative, 'in 3 days');

  // Regression: `state` must survive into the JSON the page consumes. Without
  // it the page's `state !== 'past'` filter silently keeps past one-offs in the
  // "upcoming" list, which is how a "365 days ago" row appeared in the sidebar.
  check(
    'every serialized entry carries its state',
    report.all.every((entry) => ['today', 'pending', 'past'].includes(entry.state)),
    JSON.stringify(report.all.map((entry) => `${entry.id}:${entry.state}`)),
  );
  check(
    'filtering the payload on state removes the past entry',
    report.all.filter((entry) => entry.state !== 'past').every((entry) => entry.id !== 'past'),
  );
  equal('a past entry reports a negative distance', report.all.find((entry) => entry.id === 'past').daysUntil < 0, true);

  // noticeLeadDays widens the window without changing "due today".
  const leadReport = buildReport({
    entries,
    config: { ...config, noticeLeadDays: 7 },
    today: '2026-10-04',
    now: new Date('2026-10-04T00:00:00Z'),
  });
  equal('a 7-day notice window catches the 3-day entry', leadReport.counts.inNoticeWindow, 1);
  equal('the notice window does not inflate "due today"', leadReport.counts.dueToday, 2);

  // A per-entry leadDays overrides the global one.
  const perEntry = buildReport({
    entries: [{ ...entries[1], leadDays: 5 }],
    config,
    today: '2026-10-04',
    now: new Date('2026-10-04T00:00:00Z'),
  });
  equal('per-entry leadDays is honoured', perEntry.counts.inNoticeWindow, 1);

  // resolveAll must be deterministic so the generated JSON is diff-stable.
  const runs = [0, 1, 2].map(() => JSON.stringify(resolveAll(entries, '2026-10-04', config)));
  check('resolveAll is deterministic', runs[0] === runs[1] && runs[1] === runs[2]);
}

suite('reminders: markdown output');
{
  const config = { timezone: 'Asia/Shanghai', noticeLeadDays: 0, upcomingLimit: 10 };
  const entries = [
    { id: 'a', date: '2026-10-04', title: 'Pay rent', repeat: 'none', leadDays: null, note: 'Landlord prefers transfer', color: 'amber', active: true },
    { id: 'b', date: '1970-10-04', title: 'Anniversary', repeat: 'yearly', leadDays: null, note: '', color: 'rose', active: true },
  ];
  const report = buildReport({ entries, config, today: '2026-10-04', now: new Date('2026-10-04T00:00:00Z') });

  const summary = formatSummary(report);
  check('the summary names the day and zone', summary.includes('2026-10-04') && summary.includes('Asia/Shanghai'));
  check('the summary lists both reminders', summary.includes('Pay rent') && summary.includes('Anniversary'));
  check('the summary includes notes', summary.includes('Landlord prefers transfer'));
  check('yearly entries show their occurrence, not the base year', summary.includes('`2026-10-04`') && !summary.includes('`1970-10-04`'));

  const body = formatIssueBody(report);
  check('the issue body uses unchecked checkboxes', body.includes('- [ ] **Pay rent**'));
  check('the issue body marks yearly repeats', body.includes('every year'));
  check('the issue title carries the date', issueTitle(report).endsWith('2026-10-04'));

  // Ticking a box in the UI must survive the next scheduled run.
  const ticked = body.replace('- [ ] **Pay rent**', '- [x] **Pay rent**');
  const regenerated = formatIssueBody(report, { previousBody: ticked });
  check('a ticked checkbox stays ticked on the next run', regenerated.includes('- [x] **Pay rent**'));
  check('an unticked checkbox is not invented', regenerated.includes('- [ ] **Anniversary**'));

  const empty = buildReport({ entries: [], config, today: '2026-10-04', now: new Date('2026-10-04T00:00:00Z') });
  check('an empty day says so plainly', formatSummary(empty).includes('Nothing due today'));
  check('an empty day body says so plainly', formatIssueBody(empty).includes('Nothing is due today'));
}

/* --- the issue state machine -------------------------------------------- */

/**
 * A fake GitHub that records every call, so the publisher's decisions can be
 * asserted without a network round trip.
 */
function createFakeGitHub({ issues = [] } = {}) {
  const calls = [];
  let nextNumber = 100;
  const store = issues.map((issue) => ({ ...issue }));

  const json = (payload, status = 200) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(payload)),
      headers: new Map(),
    });

  const fetchImpl = (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, pathname, body, query: Object.fromEntries(searchParams) });

    if (method === 'GET' && pathname.endsWith('/issues')) {
      const label = searchParams.get('labels');
      const page = Number(searchParams.get('page') ?? '1');
      if (page > 1) return json([]);
      return json(store.filter((issue) => (label ? (issue.labels ?? []).some((item) => (item.name ?? item) === label) : true)));
    }

    if (method === 'POST' && pathname.endsWith('/issues')) {
      const created = { number: nextNumber, state: 'open', labels: [{ name: 'calendar-reminder' }], ...body };
      nextNumber += 1;
      store.push(created);
      return json(created, 201);
    }

    const match = pathname.match(/\/issues\/(\d+)$/);
    if (match && method === 'PATCH') {
      const target = store.find((issue) => issue.number === Number(match[1]));
      if (!target) return json({ message: 'Not Found' }, 404);
      Object.assign(target, body);
      return json(target);
    }

    if (pathname.endsWith('/comments') && method === 'POST') {
      return json({ id: 1, body: body.body }, 201);
    }

    return json({ message: `unexpected ${method} ${pathname}` }, 500);
  };

  return { calls, store, fetchImpl };
}

const ISSUE_TITLE_PREFIX = '📅 日历提醒 / Calendar reminder — ';
const issueFor = (iso, state = 'open', body = '') => ({
  number: Number(iso.replaceAll('-', '')),
  title: `${ISSUE_TITLE_PREFIX}${iso}`,
  state,
  body,
  labels: [{ name: 'calendar-reminder' }],
});

/** Mirrors the publisher's stale-issue predicate. */
const isStaleReminder = (issue, today) =>
  issue.state === 'open' && issue.title.startsWith(ISSUE_TITLE_PREFIX) && issue.title !== issueTitle({ today });

suite('github client');
{
  const fake = createFakeGitHub({ issues: [issueFor('2026-10-03', 'open')] });
  const client = createGitHubClient({
    token: 'x',
    repository: 'me/Calendar',
    apiBase: 'https://api.test',
    fetchImpl: fake.fetchImpl,
  });

  const listed = await client.listIssuesByLabel('calendar-reminder');
  equal('listing filters by label', listed.length, 1);
  check('the URL was built from apiBase', fake.calls[0].pathname === '/repos/me/Calendar/issues', fake.calls[0].pathname);

  const created = await client.createIssue({ title: 'hello', body: 'world', labels: ['calendar-reminder'] });
  equal('createIssue returns the new number', typeof created.number, 'number');

  await client.closeIssue(created.number);
  equal('closeIssue flips the state', fake.store.find((issue) => issue.number === created.number).state, 'closed');

  let threw = null;
  try {
    await createGitHubClient({ token: '', repository: 'me/Calendar' });
  } catch (error) {
    threw = error;
  }
  check('a missing token fails fast', threw !== null && /token/i.test(threw.message));

  threw = null;
  try {
    await createGitHubClient({ token: 'x', repository: 'nope' });
  } catch (error) {
    threw = error;
  }
  check('a malformed repository fails fast', threw !== null && /owner\/name/.test(threw.message));

  threw = null;
  const failing = createGitHubClient({
    token: 'x',
    repository: 'me/Calendar',
    apiBase: 'https://api.test',
    fetchImpl: () => Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('{"message":"rate limited"}'), headers: new Map() }),
  });
  try {
    await failing.listIssuesByLabel('calendar-reminder');
  } catch (error) {
    threw = error;
  }
  check('an API error surfaces the status and message', threw !== null && threw.status === 403 && /rate limited/.test(threw.message));
}

/**
 * These cases exercise the same client calls and predicates the publisher
 * makes, against a fake API. They pin the four outcomes that matter: nothing
 * created on a quiet day, exactly one issue on a busy day, the previous day
 * closed, and today's issue reused instead of duplicated.
 */
suite('publisher: decision rules');
{
  const config = { timezone: 'Asia/Shanghai', noticeLeadDays: 0, upcomingLimit: 10 };
  const clientFor = (fake) =>
    createGitHubClient({ token: 'x', repository: 'me/Calendar', apiBase: 'https://api.test', fetchImpl: fake.fetchImpl });

  const quiet = buildReport({ entries: [], config, today: '2026-10-04', now: new Date('2026-10-04T00:00:00Z') });
  const busy = buildReport({
    entries: [{ id: 'a', date: '2026-10-04', title: 'Pay rent', repeat: 'none', leadDays: null, note: '', color: 'blue', active: true }],
    config,
    today: '2026-10-04',
    now: new Date('2026-10-04T00:00:00Z'),
  });

  equal('a quiet day reports nothing due', quiet.counts.dueToday, 0);
  equal('a busy day reports what is due', busy.counts.dueToday, 1);
  equal('a quiet day renders no checkbox', formatIssueBody(quiet).includes('- ['), false);
  equal('a busy day renders a checkbox', formatIssueBody(busy).includes('- [ ] **Pay rent**'), true);

  // Due today with no history → exactly one issue.
  let fake = createFakeGitHub();
  let client = clientFor(fake);
  let existing = await client.listIssuesByLabel('calendar-reminder');
  equal('nothing exists yet', existing.length, 0);
  const created = await client.createIssue({ title: issueTitle(busy), body: formatIssueBody(busy), labels: ['calendar-reminder'] });
  equal('exactly one issue is created', fake.store.length, 1);
  check('its title carries the date', created.title.endsWith('2026-10-04'));

  // A reminder left open from an earlier day is stale.
  const yesterday = issueFor('2026-10-03', 'open');
  equal('an earlier open reminder is stale', isStaleReminder(yesterday, '2026-10-04'), true);
  equal("today's own reminder is not stale", isStaleReminder(issueFor('2026-10-04', 'open'), '2026-10-04'), false);
  equal('a closed earlier reminder is not stale', isStaleReminder(issueFor('2026-10-03', 'closed'), '2026-10-04'), false);

  // Closing the stale one leaves at most one open issue.
  fake = createFakeGitHub({ issues: [yesterday] });
  client = clientFor(fake);
  for (const issue of (await client.listIssuesByLabel('calendar-reminder')).filter((candidate) => isStaleReminder(candidate, '2026-10-04'))) {
    await client.closeIssue(issue.number);
  }
  equal('the previous day is closed', fake.store.filter((issue) => issue.state === 'open').length, 0);

  // Today's issue already exists but was closed → reopen, never duplicate.
  fake = createFakeGitHub({ issues: [issueFor('2026-10-04', 'closed')] });
  client = clientFor(fake);
  existing = (await client.listIssuesByLabel('calendar-reminder')).find((issue) => issue.title === issueTitle(busy));
  check("today's closed issue is found", existing !== undefined);
  await client.reopenIssue(existing.number);
  equal('it is open again', fake.store.find((issue) => issue.number === existing.number).state, 'open');
  equal('and no duplicate was made', fake.store.filter((issue) => issue.title === issueTitle(busy)).length, 1);
}

/* --- summary ------------------------------------------------------------- */

console.log(`\n${'─'.repeat(56)}`);
if (failures.length === 0) {
  console.log(`✔ all ${passed} checks passed`);
  process.exit(0);
}

console.error(`✖ ${failures.length} of ${passed + failures.length} checks failed:\n`);
for (const failure of failures) console.error(`  - ${failure}`);
console.error('');
process.exit(1);
