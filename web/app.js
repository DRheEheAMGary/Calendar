/* ---------------------------------------------------------------------------
   Calendar — client logic.

   No framework and no build step: the page reads two JSON files produced by
   scripts/build-web.mjs and paints a month grid plus the upcoming list.

   Data contract (data/dates.json and data/reminder.json next to this file):
     { generated, timezone, noticeLeadDays, dates: [...], reminder: {...} | null }
   Each date entry is: { id, date, title, repeat, note, color }
   --------------------------------------------------------------------------- */

(() => {
  'use strict';

  const MONTH_NAMES = [
    '一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月',
  ];
  const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const COLOR_VARS = {
    blue: 'var(--blue)',
    green: 'var(--green)',
    amber: 'var(--amber)',
    rose: 'var(--rose)',
    violet: 'var(--violet)',
  };

  const elements = {
    todayLabel: document.getElementById('today-label'),
    monthLabel: document.getElementById('month-label'),
    grid: document.getElementById('calendar-grid'),
    prev: document.getElementById('prev-month'),
    next: document.getElementById('next-month'),
    todayButton: document.getElementById('today-button'),
    upcomingList: document.getElementById('upcoming-list'),
    upcomingCount: document.getElementById('upcoming-count'),
    markedBody: document.getElementById('marked-body'),
    markedCount: document.getElementById('marked-count'),
    itemTemplate: document.getElementById('event-item-template'),
    statDue: document.getElementById('stat-due'),
    statTotal: document.getElementById('stat-total'),
    statNext: document.getElementById('stat-next'),
    footerMeta: document.getElementById('footer-meta'),
  };

  const state = {
    timezone: 'UTC',
    dates: [],
    reminder: null,
    view: { year: 1970, month: 1 },
    today: '1970-01-01',
  };

  /* --- date helpers ------------------------------------------------------ */

  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const toIso = ({ year, month, day }) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

  function parseIso(iso) {
    const [year, month, day] = String(iso).split('-').map(Number);
    return { year, month, day };
  }

  function todayInZone(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return parts;
  }

  const dayNumber = ({ year, month, day }) => Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  const todayNumber = () => dayNumber(parseIso(state.today));
  const dayNumberFromIso = (iso) => dayNumber(parseIso(iso));

  function daysUntil(iso) {
    return dayNumberFromIso(iso) - todayNumber();
  }

  function isWeekend({ year, month, day }) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6;
  }

  function weekdayIndexOf({ year, month, day }) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return (weekday + 6) % 7;
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function daysInMonth(year, month) {
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function relativeLabel(days) {
    if (days === 0) return '就是今天';
    if (days === 1) return '明天';
    if (days < 0) return `已过 ${Math.abs(days)} 天`;
    if (days < 30) return `${days} 天后`;
    const months = Math.round(days / 30);
    return `约 ${months} 个月后`;
  }

  /* --- data loading ------------------------------------------------------ */

  /** Load one JSON file, preferring the build output and falling back to source data. */
  async function fetchJson(paths) {
    for (const path of paths) {
      try {
        const response = await fetch(path, { cache: 'no-cache' });
        if (response.ok) return await response.json();
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  }

  function normalizeDate(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const date = typeof entry.date === 'string' ? entry.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `${date}#${index}`,
      date,
      title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : date,
      repeat: entry.repeat === 'yearly' ? 'yearly' : 'none',
      note: typeof entry.note === 'string' ? entry.note : '',
      color: Object.prototype.hasOwnProperty.call(COLOR_VARS, entry.color) ? entry.color : 'blue',
      active: entry.active !== false,
    };
  }

  /* --- occurrences ------------------------------------------------------- */

  /** One yearly entry, placed in a specific year (29 Feb clamps to 28 Feb). */
  function occurrenceForYear(entry, year) {
    const { month, day } = parseIso(entry.date);
    return toIso({ year, month, day: Math.min(day, daysInMonth(year, month)) });
  }

  /**
   * Map "YYYY-MM-DD" -> the entries occupying that day.
   * The neighbours of the visible year are included so a yearly entry still
   * shows up when the user browses into December or January. 29 Feb is clamped
   * in common years — the same rule scripts/lib/date-utils.mjs applies.
   */
  function buildIndex(dates, view) {
    const index = new Map();
    const push = (iso, entry) => {
      if (!index.has(iso)) index.set(iso, []);
      index.get(iso).push(entry);
    };

    for (const entry of dates) {
      if (entry.repeat === 'yearly') {
        for (let year = view.year - 1; year <= view.year + 1; year += 1) {
          push(occurrenceForYear(entry, year), entry);
        }
      } else {
        push(entry.date, entry);
      }
    }
    return index;
  }

  /* --- rendering: calendar ---------------------------------------------- */

  function renderCalendar() {
    const { year, month } = state.view;
    elements.monthLabel.textContent = `${year} 年 ${MONTH_NAMES[month - 1]}`;

    const index = buildIndex(
      state.dates.filter((entry) => entry.active),
      state.view,
    );

    const fragment = document.createDocumentFragment();
    const leadingBlanks = weekdayIndexOf({ year, month, day: 1 });
    const total = daysInMonth(year, month);
    const todayIso = state.today;

    for (let blank = 0; blank < leadingBlanks; blank += 1) {
      const cell = document.createElement('div');
      cell.className = 'day day--blank';
      cell.setAttribute('aria-hidden', 'true');
      fragment.append(cell);
    }

    for (let day = 1; day <= total; day += 1) {
      const current = { year, month, day };
      const iso = toIso(current);
      const entries = index.get(iso) ?? [];
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day';
      cell.setAttribute('role', 'gridcell');

      if (isWeekend(current)) cell.classList.add('day--weekend');
      if (iso === todayIso) cell.classList.add('day--today');

      const isPast = dayNumber(current) < todayNumber();

      if (entries.length > 0) {
        const tone = COLOR_VARS[entries[0].color] ?? COLOR_VARS.blue;
        cell.classList.add('day--marked');
        cell.style.setProperty('--tone', tone);
        if (isPast) cell.classList.add('day--past');

        const names = entries.map((entry) => entry.title).join('、');
        const noteLines = entries
          .filter((entry) => entry.note)
          .map((entry) => `· ${entry.title}：${entry.note}`)
          .join('\n');
        cell.title = noteLines ? `${names}\n${noteLines}` : names;
        cell.setAttribute('aria-label', `${iso} ${names}`);
        if (noteLines) cell.classList.add('day--has-note');
        cell.addEventListener('click', () => showDetails(iso, entries));
      } else {
        cell.setAttribute('aria-label', iso);
        cell.disabled = true;
      }

      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(day);
      cell.append(number);

      if (entries.length > 0) {
        const dots = document.createElement('span');
        dots.className = 'day-dots';
        for (const entry of entries.slice(0, 3)) {
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.setProperty('--tone', COLOR_VARS[entry.color] ?? COLOR_VARS.blue);
          dots.append(dot);
        }
        cell.append(dots);
      }

      fragment.append(cell);
    }

    elements.grid.replaceChildren(fragment);
  }

  function showDetails(iso, entries) {
    const lines = entries.map((entry) => {
      const repeat = entry.repeat === 'yearly' ? '（每年）' : '';
      const note = entry.note ? `\n    ${entry.note}` : '';
      return `· ${entry.title}${repeat}${note}`;
    });
    window.alert(`${iso} ${WEEKDAY_NAMES[weekdayIndexOf(parseIso(iso))]}\n\n${lines.join('\n')}`);
  }

  /* --- rendering: lists -------------------------------------------------- */

  function renderUpcoming() {
    const { reminder, dates, today } = state;
    elements.upcomingList.replaceChildren();

    const source = reminder?.all ?? null;
    let items;

    if (source) {
      items = source.filter((entry) => entry.state !== 'past').slice(0, 12);
    } else {
      items = dates
        .filter((entry) => entry.active)
        .map((entry) => {
          const nextDate = entry.repeat === 'yearly' ? nextYearly(entry, today) : entry.date;
          return { ...entry, nextDate, daysUntil: daysUntil(nextDate), state: 'pending' };
        })
        .filter((entry) => entry.daysUntil >= 0)
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, 12);
    }

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '还没有未来日期。往 data/dates.json 里加一条吧。';
      elements.upcomingList.append(empty);
    }

    for (const entry of items) {
      const node = elements.itemTemplate.content.firstElementChild.cloneNode(true);
      const tone = COLOR_VARS[entry.color] ?? COLOR_VARS.blue;
      node.style.setProperty('--tone', tone);
      if (entry.daysUntil === 0) node.classList.add('event-item--today');

      node.querySelector('.event-title').textContent = entry.title;
      node.querySelector('.event-meta').textContent =
        `${entry.nextDate} ${WEEKDAY_NAMES[weekdayIndexOf(parseIso(entry.nextDate))]}` +
        (entry.repeat === 'yearly' ? ' · 每年' : '');
      node.querySelector('.event-note').textContent = entry.note ?? '';
      node.querySelector('.event-when').textContent =
        entry.relative ?? relativeLabel(entry.daysUntil);

      elements.upcomingList.append(node);
    }

    elements.upcomingCount.textContent = String(items.length);
  }

  /** Next yearly occurrence on or after `today`, mirroring the server rule. */
  function nextYearly(entry, today) {
    const { month, day } = parseIso(entry.date);
    const fromYear = Number(today.slice(0, 4));
    for (let year = fromYear; year <= fromYear + 8; year += 1) {
      const candidate = toIso({ year, month, day: Math.min(day, daysInMonth(year, month)) });
      if (dayNumberFromIso(candidate) >= dayNumberFromIso(today)) return candidate;
    }
    return entry.date;
  }

  function renderTable() {
    const { reminder, dates } = state;
    elements.markedBody.replaceChildren();

    const source =
      reminder?.all?.map((entry) => ({
        ...entry,
        active: true,
      })) ??
      dates.map((entry) => ({
        ...entry,
        nextDate: entry.repeat === 'yearly' ? nextYearly(entry, state.today) : entry.date,
        daysUntil: daysUntil(entry.repeat === 'yearly' ? nextYearly(entry, state.today) : entry.date),
        state: 'pending',
      }));

    const rows = [...source].sort((a, b) => (a.nextDate ?? a.date).localeCompare(b.nextDate ?? b.date));
    elements.markedCount.textContent = String(rows.length);

    if (rows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = 'data/dates.json 里还没有任何日期。';
      row.append(cell);
      elements.markedBody.append(row);
      return;
    }

    for (const entry of rows) {
      const row = document.createElement('tr');
      const tone = COLOR_VARS[entry.color] ?? COLOR_VARS.blue;
      row.style.setProperty('--tone', tone);
      if (entry.state === 'past') row.classList.add('row--past');

      const dateCell = document.createElement('td');
      dateCell.className = 'cell-date';
      dateCell.textContent = entry.nextDate ?? entry.date;

      const titleCell = document.createElement('td');
      titleCell.textContent = entry.title;
      if (entry.note) {
        const note = document.createElement('span');
        note.className = 'event-note';
        note.textContent = ` — ${entry.note}`;
        titleCell.append(note);
      }

      const repeatCell = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent =
        entry.repeat === 'yearly' ? '每年' : entry.state === 'past' ? '已过去' : '一次性';
      repeatCell.append(tag);

      const whenCell = document.createElement('td');
      const whenTag = document.createElement('span');
      whenTag.className = entry.daysUntil === 0 ? 'tag tag--today' : 'tag';
      whenTag.textContent = entry.relative ?? relativeLabel(entry.daysUntil ?? 0);
      whenCell.append(whenTag);

      row.append(dateCell, titleCell, repeatCell, whenCell);
      elements.markedBody.append(row);
    }
  }

  function renderStats() {
    const { reminder, dates, today } = state;
    const active = dates.filter((entry) => entry.active);
    const dueToday = reminder?.counts?.dueToday ?? dueTodayFallback(active, today);
    const nextUp = (reminder?.all ?? [])
      .filter((entry) => entry.state !== 'past')
      .find((entry) => entry.daysUntil > 0);

    elements.statDue.textContent = String(dueToday);
    elements.statTotal.textContent = String(active.length);
    elements.statNext.textContent = nextUp ? relativeLabel(nextUp.daysUntil).replace('后', '') : '—';
  }

  function dueTodayFallback(active, today) {
    let count = 0;
    for (const entry of active) {
      if (entry.repeat === 'yearly') {
        if (nextYearly(entry, today) === today) count += 1;
      } else if (entry.date === today) {
        count += 1;
      }
    }
    return count;
  }

  function renderHeader() {
    const parsed = parseIso(state.today);
    elements.todayLabel.textContent =
      `${state.today} ${WEEKDAY_NAMES[weekdayIndexOf(parsed)]} · ${state.timezone}`;
  }

  function renderFooter(payload) {
    const generated = payload?.generated ?? payload?.reminder?.generatedAt ?? null;
    const stamp = generated
      ? new Date(generated).toLocaleString('zh-CN', { timeZone: state.timezone, hour12: false })
      : '未知';
    elements.footerMeta.textContent = `数据生成于 ${stamp} · 时区 ${state.timezone} · 提前 ${state.noticeLeadDays} 天提醒`;
  }

  function renderAll() {
    renderHeader();
    renderCalendar();
    renderUpcoming();
    renderTable();
    renderStats();
  }

  /* --- wiring ------------------------------------------------------------ */

  function shiftView(delta) {
    const zeroBased = state.view.year * 12 + (state.view.month - 1) + delta;
    state.view = { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
    renderCalendar();
  }

  function bindControls() {
    elements.prev.addEventListener('click', () => shiftView(-1));
    elements.next.addEventListener('click', () => shiftView(1));
    elements.todayButton.addEventListener('click', () => {
      const parsed = parseIso(state.today);
      state.view = { year: parsed.year, month: parsed.month };
      renderCalendar();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') shiftView(-1);
      if (event.key === 'ArrowRight') shiftView(1);
    });
  }

  function showLoadError(message) {
    const banner = document.createElement('p');
    banner.className = 'empty';
    banner.textContent = message;
    elements.upcomingList.replaceChildren(banner);
  }

  async function init() {
    const payload =
      (await fetchJson(['./data/dates.json', '../data/dates.json'])) ?? { dates: [], timezone: 'UTC' };

    state.timezone = typeof payload.timezone === 'string' ? payload.timezone : 'UTC';
    state.noticeLeadDays = Number.isInteger(payload.noticeLeadDays) ? payload.noticeLeadDays : 0;
    state.dates = (Array.isArray(payload.dates) ? payload.dates : []).map(normalizeDate).filter(Boolean);
    state.reminder = payload.reminder ?? null;
    state.today = todayInZone(state.timezone);

    const parsedToday = parseIso(state.today);
    state.view = { year: parsedToday.year, month: parsedToday.month };

    bindControls();
    renderAll();
    renderFooter(payload);

    if (state.dates.length === 0) {
      showLoadError('没有读到任何日期。请检查 data/dates.json 是否存在且格式正确。');
    }
  }

  init();
})();
