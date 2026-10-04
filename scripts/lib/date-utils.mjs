/**
 * date-utils.mjs — timezone-correct calendar math with zero dependencies.
 *
 * Everything here works on plain { year, month, day } objects or on
 * "YYYY-MM-DD" strings, so no Date object can leak a timezone bug into the
 * reminder logic. The GitHub Actions runner is UTC while the calendar is
 * Asia/Shanghai, so "what day is it today" must always be asked explicitly
 * for the configured zone.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Cache one Intl formatter per zone; constructing them is the expensive part. */
const formatterCache = new Map();

function zoneFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      throw new Error(`Unknown IANA timezone: ${timeZone}`);
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Assert a zone is usable, so a typo fails loudly instead of silently using UTC. */
export function assertTimezone(timeZone) {
  zoneFormatter(timeZone);
}

/** "YYYY-MM-DD" in the given zone for the given instant. */
export function todayInZone(timeZone, instant = new Date()) {
  return zoneFormatter(timeZone).format(instant);
}

/** "YYYY-MM-DD" -> { year, month, day }; throws on anything else. */
export function parseIso(iso) {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) {
    throw new Error(`Expected a YYYY-MM-DD date, received: ${JSON.stringify(iso)}`);
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Not a real calendar date: ${iso}`);
  }
  return { year, month, day };
}

/** { year, month, day } -> "YYYY-MM-DD". */
export function toIso({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Days since the epoch, used only for differences — never for local time. */
export function dayNumber({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/** addDays('2026-02-27', 2) -> '2026-03-01' */
export function addDays(iso, delta) {
  const { year, month, day } = parseIso(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return toIso({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** How many days from `fromIso` to `toIso`; negative when `toIso` is earlier. */
export function diffDays(fromIso, toIsoValue) {
  return dayNumber(parseIso(toIsoValue)) - dayNumber(parseIso(fromIso));
}

/**
 * Yearly events use only month/day. 29 Feb is clamped, so a leap-day
 * anniversary is observed on 28 Feb in common years instead of disappearing.
 */
export function nextYearlyOccurrence(iso, fromIso) {
  const { month, day } = parseIso(iso);
  const { year: fromYear } = parseIso(fromIso);
  for (let year = fromYear; year <= fromYear + 8; year += 1) {
    const clampedDay = Math.min(day, daysInMonth(year, month));
    const candidate = toIso({ year, month, day: clampedDay });
    if (diffDays(fromIso, candidate) >= 0) return candidate;
  }
  /* istanbul ignore next — unreachable for valid input */
  throw new Error(`Could not resolve a yearly occurrence for ${iso}`);
}

/** Weekday index for a date, 0 = Monday … 6 = Sunday. */
export function weekdayIndex({ year, month, day }) {
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayBased + 6) % 7;
}

/** First day of the month, as { year, month, day: 1 }. */
export function firstOfMonth(year, month) {
  return { year, month, day: 1 };
}

/** Shift a year/month pair by `delta` months, returning a valid pair. */
export function shiftMonth(year, month, delta) {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** How many reminders an entry wants before its own date. */
export function effectiveLeadDays(entry, config) {
  const globalLead = Number.isInteger(config.noticeLeadDays) ? config.noticeLeadDays : 0;
  return Number.isInteger(entry.leadDays) ? entry.leadDays : globalLead;
}

/**
 * Resolve the reminder state of one entry relative to `today`.
 *   state 'today'   → it is the day itself
 *   state 'pending' → still ahead (a one-off may already sit inside its notice window)
 *   state 'past'    → a one-off that already happened
 */
export function resolveEntry(entry, today, globalLeadDays = 0) {
  const isYearly = entry.repeat === 'yearly';
  let nextDate;
  let state;

  if (isYearly) {
    nextDate = nextYearlyOccurrence(entry.date, today);
    state = nextDate === today ? 'today' : 'pending';
  } else if (entry.date === today) {
    nextDate = entry.date;
    state = 'today';
  } else if (diffDays(today, entry.date) > 0) {
    nextDate = entry.date;
    state = 'pending';
  } else {
    nextDate = entry.date;
    state = 'past';
  }

  const daysUntil = diffDays(today, nextDate);
  const leadDays = effectiveLeadDays(entry, { noticeLeadDays: globalLeadDays });

  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    repeat: entry.repeat,
    note: entry.note ?? '',
    color: entry.color ?? 'blue',
    leadDays,
    nextDate,
    daysUntil,
    state,
    /** Within the notice window, today included. */
    due: state !== 'past' && daysUntil >= 0 && daysUntil <= leadDays,
    /** The day itself, regardless of the notice window. */
    isToday: state === 'today',
  };
}

/** Build a full projection for every entry, sorted by how soon it happens. */
export function resolveAll(entries, today, config) {
  const globalLeadDays = Number.isInteger(config.noticeLeadDays) ? config.noticeLeadDays : 0;
  return entries
    .map((entry) => resolveEntry(entry, today, globalLeadDays))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));
}
