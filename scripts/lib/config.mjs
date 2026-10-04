/**
 * config.mjs — load data/config.json and data/dates.json, validate both, and
 * give every caller the same normalized shape.
 *
 * Validation is hand-written rather than schema-library driven so the whole
 * project stays dependency-free: `npm install` is never needed, which keeps the
 * GitHub Actions runs fast and immune to registry outages.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISO_DATE_RE, assertTimezone, parseIso } from './date-utils.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_DATES_PATH = path.join(ROOT, 'data', 'dates.json');
export const DEFAULT_CONFIG_PATH = path.join(ROOT, 'data', 'config.json');

const REPEAT_MODES = new Set(['none', 'yearly']);
const COLORS = new Set(['blue', 'green', 'amber', 'rose', 'violet']);
const DATE_KEYS = new Set(['id', 'date', 'title', 'repeat', 'leadDays', 'note', 'color', 'active']);
const CONFIG_KEYS = new Set(['$schema', 'timezone', 'noticeLeadDays', 'upcomingLimit']);

/** Read a JSON file, turning parse errors into messages that name the file. */
function readJson(filePath, problems) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    problems.push(`${path.relative(ROOT, filePath)}: cannot be read (${error.code ?? error.message})`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    problems.push(`${path.relative(ROOT, filePath)}: is not valid JSON — ${error.message}`);
    return null;
  }
}

export function validateConfig(value, problems = []) {
  const config = { timezone: 'Asia/Shanghai', noticeLeadDays: 0, upcomingLimit: 10 };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.push('data/config.json: the top level must be an object');
    return { config, problems };
  }

  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) problems.push(`data/config.json: unknown key "${key}"`);
  }

  if (typeof value.timezone !== 'string' || value.timezone.trim() === '') {
    problems.push('data/config.json: "timezone" is required and must be an IANA name such as "Asia/Shanghai"');
  } else {
    try {
      assertTimezone(value.timezone);
      config.timezone = value.timezone;
    } catch (error) {
      problems.push(`data/config.json: ${error.message}`);
    }
  }

  if (value.noticeLeadDays !== undefined) {
    if (!Number.isInteger(value.noticeLeadDays) || value.noticeLeadDays < 0 || value.noticeLeadDays > 366) {
      problems.push('data/config.json: "noticeLeadDays" must be an integer between 0 and 366');
    } else {
      config.noticeLeadDays = value.noticeLeadDays;
    }
  }

  if (value.upcomingLimit !== undefined) {
    if (!Number.isInteger(value.upcomingLimit) || value.upcomingLimit < 1 || value.upcomingLimit > 30) {
      problems.push('data/config.json: "upcomingLimit" must be an integer between 1 and 30');
    } else {
      config.upcomingLimit = value.upcomingLimit;
    }
  }

  return { config, problems };
}

export function validateDates(value, problems = []) {
  if (!Array.isArray(value)) {
    problems.push('data/dates.json: the top level must be an array of date entries');
    return { entries: [], problems };
  }

  const entries = [];
  const seenIds = new Map();

  value.forEach((item, index) => {
    const at = `data/dates.json[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${at}: must be an object`);
      return;
    }

    for (const key of Object.keys(item)) {
      if (!DATE_KEYS.has(key)) problems.push(`${at}: unknown key "${key}"`);
    }

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (title === '') problems.push(`${at}: "title" is required and must be a non-empty string`);
    if (title.length > 80) problems.push(`${at}: "title" must be at most 80 characters`);

    let dateOk = false;
    if (typeof item.date !== 'string' || !ISO_DATE_RE.test(item.date)) {
      problems.push(`${at}: "date" must be a YYYY-MM-DD string, received ${JSON.stringify(item.date)}`);
    } else {
      try {
        parseIso(item.date);
        dateOk = true;
      } catch (error) {
        problems.push(`${at}: ${error.message}`);
      }
    }

    const repeat = item.repeat === undefined ? 'none' : item.repeat;
    if (!REPEAT_MODES.has(repeat)) {
      problems.push(`${at}: "repeat" must be "none" or "yearly", received ${JSON.stringify(item.repeat)}`);
    }

    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        problems.push(`${at}: "id" must be a non-empty string when present`);
      } else if (seenIds.has(item.id)) {
        problems.push(`${at}: duplicate id "${item.id}" (already used at index ${seenIds.get(item.id)})`);
      } else {
        seenIds.set(item.id, index);
      }
    } else if (repeat === 'yearly') {
      problems.push(`${at}: "id" is required for repeat "yearly" so renaming the title keeps its identity`);
    }

    if (item.leadDays !== undefined && item.leadDays !== null) {
      if (!Number.isInteger(item.leadDays) || item.leadDays < 0 || item.leadDays > 366) {
        problems.push(`${at}: "leadDays" must be null or an integer between 0 and 366`);
      }
    }

    if (item.note !== undefined) {
      if (typeof item.note !== 'string') problems.push(`${at}: "note" must be a string`);
      else if (item.note.length > 400) problems.push(`${at}: "note" must be at most 400 characters`);
    }

    if (item.color !== undefined && !COLORS.has(item.color)) {
      problems.push(`${at}: "color" must be one of ${[...COLORS].join(', ')}`);
    }

    if (item.active !== undefined && typeof item.active !== 'boolean') {
      problems.push(`${at}: "active" must be true or false`);
    }

    if (!title || !dateOk) return;

    entries.push({
      id: typeof item.id === 'string' && item.id.trim() !== '' ? item.id.trim() : `${item.date}#${title}`,
      date: item.date,
      title,
      repeat,
      leadDays: Number.isInteger(item.leadDays) ? item.leadDays : null,
      note: typeof item.note === 'string' ? item.note.trim() : '',
      color: COLORS.has(item.color) ? item.color : 'blue',
      active: item.active !== false,
      explicitId: typeof item.id === 'string' && item.id.trim() !== '',
    });
  });

  return { entries, problems };
}

/** Load + validate both data files. Returns entries already filtered to active. */
export function loadProject({ datesPath = DEFAULT_DATES_PATH, configPath = DEFAULT_CONFIG_PATH } = {}) {
  const problems = [];
  const { config } = validateConfig(readJson(configPath, problems), problems);
  const { entries } = validateDates(readJson(datesPath, problems), problems);

  if (problems.length > 0) {
    const error = new Error(`The calendar data is not valid:\n  - ${problems.join('\n  - ')}`);
    error.problems = problems;
    throw error;
  }

  return {
    config,
    entries,
    allEntries: entries,
    activeEntries: entries.filter((entry) => entry.active),
    datesPath,
    configPath,
  };
}

/** Minimal `--flag value` parser shared by the scripts. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const [flag, inlineValue] = token.slice(2).split('=');
      if (inlineValue !== undefined) {
        args[flag] = inlineValue;
      } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
        args[flag] = argv[index + 1];
        index += 1;
      } else {
        args[flag] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}
