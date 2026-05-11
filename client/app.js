// WorkPulse — single-file frontend.
//
// State held in module scope; persisted bits go to localStorage.

const state = {
  // Active month being viewed.
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  // Selected day (YYYY-MM-DD) or null.
  selected: null,
  // Last fetched payload.
  events: { github: [], slack: [], calendar: [] },
  // Per-day index built from events: { 'YYYY-MM-DD': { gh: n, sl: n } }
  dayIndex: {},
  // Mappings list.
  mappings: [],
  // Health/config.
  health: { config: {} },
  // Tempo logs persisted by date in localStorage.
  tempoByDay: loadTempo(),
  // Real worklogs fetched from Tempo for the active month.
  worklogs: [],
  // Favorite tasks (persisted in localStorage).
  favorites: loadFavorites(),
  loading: false,
};

// Active source filters for the day timeline (left/activity column only). Resets on reload.
let timelineFilters = new Set(['github', 'slack', 'email']);

const KIND_LABELS = {
  commit: 'commit',
  'pr-opened': 'PR opened',
  'pr-closed': 'PR closed',
  'pr-merged': 'PR merged',
  'pr-reopened': 'PR reopened',
  'pr-edited': 'PR edited',
  'review-approved': 'approved',
  'review-changes-requested': 'changes',
  'review-commented': 'review',
  'review-comment': 'review note',
  'pr-comment': 'PR comment',
  'issue-comment': 'issue comment',
  'branch-created': 'new branch',
  message: 'msg',
  dm: 'dm',
  mpim: 'group dm',
  event: 'meeting',
  'event-tentative': 'tentative',
  'event-all-day': 'all day',
  'email-sent': 'email',
};

// ---------- localStorage ----------
function loadTempo() {
  try { return JSON.parse(localStorage.getItem('workpulse:tempo') || '{}'); }
  catch { return {}; }
}
function saveTempo() {
  localStorage.setItem('workpulse:tempo', JSON.stringify(state.tempoByDay));
}
function loadFavorites() {
  try {
    const arr = JSON.parse(localStorage.getItem('workpulse:favorites') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveFavorites() {
  localStorage.setItem('workpulse:favorites', JSON.stringify(state.favorites));
}

// ---------- helpers ----------
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseISO(s) { return new Date(s); }
function localDay(iso) {
  const d = parseISO(iso);
  return ymd(d);
}
function hhmm(iso) {
  const d = parseISO(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timeToMinutesOfDay(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

// Source-aware context label with # for Slack channels and highlighted repo for GitHub.
function ctxHtml(source, repoOrChannel) {
  const raw = repoOrChannel || '?';
  if (source === 'slack') {
    if (raw.startsWith('dm:')) return `<span class="ctx ctx-sl">↗ ${escapeHtml(raw.slice(3))}</span>`;
    if (raw.startsWith('mpim:')) return `<span class="ctx ctx-sl">⊕ ${escapeHtml(raw.slice(5))}</span>`;
    return `<span class="ctx ctx-sl"># ${escapeHtml(raw)}</span>`;
  }
  if (source === 'github') {
    const slash = raw.lastIndexOf('/');
    if (slash >= 0) {
      return `<span class="ctx ctx-gh"><span class="ctx-org">${escapeHtml(raw.slice(0, slash + 1))}</span>${escapeHtml(raw.slice(slash + 1))}</span>`;
    }
    return `<span class="ctx ctx-gh">${escapeHtml(raw)}</span>`;
  }
  if (source === 'calendar') return `<span class="ctx ctx-cal">${escapeHtml(raw)}</span>`;
  if (source === 'email')    return `<span class="ctx ctx-email">${escapeHtml(raw)}</span>`;
  return `<span class="ctx">${escapeHtml(raw)}</span>`;
}
function monthName(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function dayLong(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function parseDuration(input) {
  if (!input) return 0;
  const s = String(input).trim().toLowerCase();
  if (!s) return 0;
  // Plain number = minutes
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60;
  // Decimal hours: "1.5"
  if (/^\d+\.\d+$/.test(s)) return Math.round(parseFloat(s) * 3600);
  // 1h 30m / 1h30m / 90m / 2h
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(h|m)/g;
  let match, found = false;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const v = parseFloat(match[1]);
    total += match[2] === 'h' ? v * 3600 : v * 60;
  }
  return found ? Math.round(total) : 0;
}

function formatDuration(seconds) {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function projectFor(event) {
  if (!state.mappings.length) return null;
  if (event.source === 'github') {
    const m = state.mappings.find((x) => x.type === 'github' && x.key.toLowerCase() === (event.repoOrChannel || '').toLowerCase());
    return m ? m.project : null;
  }
  if (event.source === 'slack') {
    const ch = event.repoOrChannel || '';
    if (ch.startsWith('dm:')) {
      const name = ch.slice(3).toLowerCase();
      const m = state.mappings.find((x) => x.type === 'slack-dm' && x.key.toLowerCase() === name);
      return m ? m.project : null;
    }
    const m = state.mappings.find((x) => x.type === 'slack' && x.key.toLowerCase() === ch.toLowerCase());
    return m ? m.project : null;
  }
  return null;
}

function rebuildDayIndex() {
  const idx = {};
  const day = (e) => { const d = localDay(e.time); return (idx[d] ||= { gh: 0, sl: 0, em: 0 }); };
  for (const e of state.events.github)           day(e).gh++;
  for (const e of state.events.slack)            day(e).sl++;
  for (const e of (state.events.email || []))    day(e).em++;
  state.dayIndex = idx;
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadHealth() {
  state.health = await api('/api/health');
  renderStatusPill();
}

async function loadMappings() {
  state.mappings = await api('/api/mappings');
}

async function saveMappings(list) {
  state.mappings = await api('/api/mappings', {
    method: 'PUT',
    body: JSON.stringify(list),
  });
}

async function loadWorklogs({ refresh = false } = {}) {
  if (!state.health.config || !state.health.config.tempo) {
    state.worklogs = [];
    return;
  }
  try {
    const url = `/api/tempo/worklogs?year=${state.year}&month=${state.month}${refresh ? '&refresh=1' : ''}`;
    const data = await api(url);
    state.worklogs = data.worklogs || [];
  } catch (e) {
    state.worklogs = [];
    toast(`Tempo worklogs: ${e.message}`, 'err');
  }
}

async function loadEvents({ refresh = false } = {}) {
  state.loading = true;
  renderStatusPill();
  try {
    const url = `/api/events?year=${state.year}&month=${state.month}${refresh ? '&refresh=1' : ''}`;
    const data = await api(url);
    state.events = {
      github:   data.github   || [],
      slack:    data.slack    || [],
      calendar: data.calendar || [],
      email:    data.email    || [],
    };
    rebuildDayIndex();
    const errMsgs = [];
    if (data.errors?.github)   errMsgs.push(`GitHub: ${data.errors.github}`);
    if (data.errors?.slack)    errMsgs.push(`Slack: ${data.errors.slack}`);
    if (data.errors?.calendar) errMsgs.push(`Calendar: ${data.errors.calendar}`);
    if (data.errors?.email)    errMsgs.push(`Gmail: ${data.errors.email}`);
    if (errMsgs.length) toast(errMsgs.join(' · '), 'err');
  } finally {
    state.loading = false;
    renderStatusPill();
  }
}

// ---------- rendering: status ----------
function renderStatusPill() {
  const el = document.getElementById('status-pill');
  if (state.loading) {
    el.textContent = 'Loading…';
    el.className = 'pill warn';
    return;
  }
  const c = state.health.config || {};
  const parts = [];
  parts.push(`gh:${c.github ? '✓' : '✕'}`);
  parts.push(`sl:${c.slack ? '✓' : '✕'}`);
  parts.push(`tempo:${c.tempo ? '✓' : '✕'}`);
  if (c.google) parts.push(`gcal:${state.health.googleConnected ? '✓' : '✕'}`);
  el.textContent = parts.join(' ');
  el.className = 'pill ' + (c.github || c.slack ? 'ok' : 'warn');
}

// ---------- rendering: calendar ----------
function renderCalendar() {
  document.getElementById('month-label').textContent = monthName(state.year, state.month);
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) {
    const cell = document.createElement('div');
    cell.className = 'cal-dow';
    cell.textContent = d;
    grid.appendChild(cell);
  }

  const first = new Date(state.year, state.month - 1, 1);
  // Monday=0 ... Sunday=6
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(state.year, state.month, 0).getDate();
  const todayStr = ymd(new Date());

  // Leading outside days
  const prevMonthDays = new Date(state.year, state.month - 1, 0).getDate();
  for (let i = offset - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'cal-day outside';
    cell.textContent = String(prevMonthDays - i);
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    const dStr = `${state.year}-${pad(state.month)}-${pad(day)}`;
    cell.className = 'cal-day';
    if (dStr === todayStr) cell.classList.add('today');
    if (dStr === state.selected) cell.classList.add('selected');
    cell.textContent = String(day);

    const idx = state.dayIndex[dStr];
    if (idx) {
      const dots = document.createElement('div');
      dots.className = 'dots';
      if (idx.gh) {
        const d = document.createElement('i');
        d.className = 'dot dot-gh';
        d.title = `${idx.gh} GitHub event(s)`;
        dots.appendChild(d);
      }
      if (idx.sl) {
        const d = document.createElement('i');
        d.className = 'dot dot-sl';
        d.title = `${idx.sl} Slack message(s)`;
        dots.appendChild(d);
      }
      if (idx.em) {
        const d = document.createElement('i');
        d.className = 'dot dot-email';
        d.title = `${idx.em} sent email(s)`;
        dots.appendChild(d);
      }
      cell.appendChild(dots);
    }
    cell.addEventListener('click', () => selectDay(dStr));
    grid.appendChild(cell);
  }

  cal.appendChild(grid);
  renderWeeklySummary();
}

function renderWeeklySummary() {
  const el = document.getElementById('weekly-summary');
  const monthPrefix = `${state.year}-${pad(state.month)}`;

  // Real Tempo worklogs by project
  const logged = {};
  for (const w of state.worklogs) {
    if (!w.startDate || !w.startDate.startsWith(monthPrefix)) continue;
    const proj = (w.issueKey || '').split('-')[0] || '?';
    logged[proj] = (logged[proj] || 0) + (parseInt(w.timeSpentSeconds, 10) || 0);
  }

  // Local drafts by day
  const draftsByDay = {};
  for (const date of Object.keys(state.tempoByDay)) {
    if (!date.startsWith(monthPrefix)) continue;
    const total = state.tempoByDay[date].reduce((s, e) => s + (parseInt(e.timeSeconds, 10) || 0), 0);
    if (total > 0) draftsByDay[date] = total;
  }

  const tempoConfigured = !!(state.health.config && state.health.config.tempo);

  let html = '';
  if (tempoConfigured) {
    const items = Object.entries(logged).sort((a, b) => b[1] - a[1]);
    const total = items.reduce((s, [, v]) => s + v, 0);
    html += '<h4>Logged in Tempo</h4>';
    if (items.length === 0) {
      html += '<div class="muted">No worklogs this month.</div>';
    } else {
      html += items.map(([p, v]) => `<div class="row"><span class="proj-tag">${escapeHtml(p)}</span><span>${formatDuration(v)}</span></div>`).join('');
      html += `<div class="row total-row"><strong>Total</strong><strong>${formatDuration(total)}</strong></div>`;
    }
  }

  const draftDays = Object.entries(draftsByDay).sort(([a], [b]) => a.localeCompare(b));
  if (draftDays.length) {
    const dt = draftDays.reduce((s, [, v]) => s + v, 0);
    html += '<h4 style="margin-top:12px">Drafts (not sent)</h4>';
    html += draftDays.map(([date, v]) => {
      const [y, mo, d] = date.split('-').map(Number);
      const label = new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'numeric' });
      return `<div class="row draft-day-row" data-day="${escapeHtml(date)}"><span>${escapeHtml(label)}</span><span>${formatDuration(v)}</span></div>`;
    }).join('');
    html += `<div class="row total-row"><strong>Total</strong><strong>${formatDuration(dt)}</strong></div>`;
  } else if (!tempoConfigured) {
    html += '<h4>Drafts</h4><div class="muted">No drafts. Click events to add.</div>';
  }

  el.innerHTML = html;
  for (const row of el.querySelectorAll('.draft-day-row[data-day]')) {
    row.addEventListener('click', () => selectDay(row.dataset.day));
  }
}

// ---------- rendering: day detail ----------

function buildDayTimeline(day) {
  const items = [];
  const counts = { github: 0, slack: 0, tempo: 0, calendar: 0, email: 0 };

  for (const w of state.worklogs.filter((w) => w.startDate === day)) {
    const t = (w.startTime || '').slice(0, 5) || '00:00';
    items.push({
      _type: 'worklog', sortKey: t, displayTime: t, source: 'tempo',
      duration: parseInt(w.timeSpentSeconds, 10) || 0,
      issueKey: w.issueKey, description: w.description || '', raw: w,
    });
    counts.tempo++;
  }
  for (const e of state.events.github.filter((e) => localDay(e.time) === day)) {
    const t = hhmm(e.time);
    items.push({
      _type: 'event', sortKey: t, displayTime: t, source: 'github',
      id: String(e.id), repoOrChannel: e.repoOrChannel, kind: e.kind,
      title: e.title, url: e.url || null,
      branch: e.branch || null, prNumber: e.prNumber || null, sha: e.sha || null, raw: e,
    });
    counts.github++;
  }
  for (const e of state.events.slack.filter((e) => localDay(e.time) === day)) {
    const t = hhmm(e.time);
    items.push({
      _type: 'event', sortKey: t, displayTime: t, source: 'slack',
      id: String(e.id), repoOrChannel: e.repoOrChannel, kind: e.kind,
      title: e.title, url: e.url || null, raw: e,
    });
    counts.slack++;
  }
  for (const e of (state.events.calendar || []).filter((e) => localDay(e.time) === day)) {
    const t = hhmm(e.time);
    items.push({
      _type: 'event', sortKey: t, displayTime: t, source: 'calendar',
      id: String(e.id), repoOrChannel: e.repoOrChannel || '', kind: e.kind || 'event',
      title: e.title, url: e.url || null, duration: e.duration || 0, raw: e,
    });
    counts.calendar++;
  }
  for (const e of (state.events.email || []).filter((e) => localDay(e.time) === day)) {
    const t = hhmm(e.time);
    items.push({
      _type: 'event', sortKey: t, displayTime: t, source: 'email',
      id: String(e.id), repoOrChannel: e.repoOrChannel || '', kind: e.kind || 'email-sent',
      title: e.title, url: e.url || null, raw: e,
    });
    counts.email++;
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return { items, counts };
}

function renderFilterChips(counts) {
  const sources = [
    { key: 'github',   label: 'GH' },
    { key: 'slack',    label: 'SL' },
    ...(counts.email > 0 ? [{ key: 'email', label: 'Mail' }] : []),
  ];
  const chips = sources.map(({ key, label }) => {
    const n = counts[key] || 0;
    const active = timelineFilters.has(key) ? ' active' : '';
    const disabled = n === 0 ? ' disabled' : '';
    return `<button class="filter-chip ${key}${active}${disabled}" data-source="${key}">${escapeHtml(label)} <span class="chip-count">${n}</span></button>`;
  });
  return `<div class="filter-chips">${chips.join('')}</div>`;
}

function renderTimelineRow(item, addedSet) {
  if (item._type === 'worklog') {
    return `
      <div class="event worklog" title="Logged in Tempo">
        <span class="time">${escapeHtml(item.displayTime)}</span>
        <span class="badge tempo">${formatDuration(item.duration)}</span>
        <div>
          <div class="title">${item.description ? escapeHtml(item.description) : '<span class="muted">(no description)</span>'}</div>
          <div class="meta"><span class="ctx">${escapeHtml(item.issueKey || '')}</span></div>
        </div>
        <span class="proj has">${escapeHtml(item.issueKey || '—')}</span>
      </div>`;
  }

  const added = addedSet.has(item.id);
  const proj = projectFor(item.raw);
  const kind = KIND_LABELS[item.kind] || item.kind;
  const link = item.url ? ` <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>` : '';

  let loggedTag = '';
  if (added) {
    const entry = (state.tempoByDay[state.selected] || [])
      .find((e) => (e.sourceIds || []).includes(item.id));
    if (entry) {
      loggedTag = `<span class="logged-tag">${escapeHtml(entry.issueKey || '?')} · ${formatDuration(entry.timeSeconds)}</span>`;
    }
  }

  const meta = [];
  if (item.source === 'email') {
    meta.push(`<span class="ctx ctx-email">To: ${escapeHtml(item.repoOrChannel || '?')}</span>`);
  } else {
    meta.push(ctxHtml(item.source, item.repoOrChannel));
    if (item.branch) meta.push(`<code>${escapeHtml(item.branch)}</code>`);
    if (item.prNumber) meta.push(`#${item.prNumber}`);
    if (item.sha) meta.push(`<code>${item.sha}</code>`);
  }

  return `
    <div class="event${added ? ' added' : ''}" data-id="${item.id}" data-source="${item.source}" title="Click to add to Tempo log">
      <span class="time">${escapeHtml(item.displayTime)}</span>
      <span class="badge ${item.source}">${escapeHtml(kind)}</span>
      <div>
        <div class="title">${escapeHtml(item.title || '(no title)')}${link}${loggedTag}</div>
        <div class="meta">${meta.join(' · ')}</div>
      </div>
      <span class="${proj ? 'proj has' : 'proj miss'}">${escapeHtml(proj || '?')}</span>
    </div>`;
}

// ---------- Two-column day layout constants ----------
const PX_PER_MIN   = 1.5;
const GRID_START   = 9 * 60;   // 09:00
const GRID_END     = 20 * 60;  // 20:00
const EVENT_H      = 50;       // estimated px height of a normal event row (incl. gap)
const COMPACT_H    = 38;       // estimated px height of a compact group row
const TEMPO_COL_W  = 220;      // px width of right tempo column (44px labels + 172px blocks)

// ---------- Event merging ----------
const MERGE_GAP_MIN = 30;
const MERGEABLE_SOURCES = new Set(['github', 'slack']);

function mergeNearbyItems(items) {
  const sorted = [...items].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const byKey  = new Map();
  const result = [];

  for (const item of sorted) {
    if (!MERGEABLE_SOURCES.has(item.source)) { result.push(item); continue; }
    const k = `${item.source}::${item.repoOrChannel || ''}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(item);
  }

  for (const [, keyItems] of byKey) {
    let group = [keyItems[0]];
    for (let i = 1; i < keyItems.length; i++) {
      const gap = timeToMinutesOfDay(keyItems[i].displayTime) - timeToMinutesOfDay(group[group.length - 1].displayTime);
      if (gap <= MERGE_GAP_MIN) {
        group.push(keyItems[i]);
      } else {
        result.push(group.length === 1 ? group[0] : makeMergedItem(group));
        group = [keyItems[i]];
      }
    }
    result.push(group.length === 1 ? group[0] : makeMergedItem(group));
  }

  return result.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function makeMergedItem(items) {
  const first = items[0];
  const last  = items[items.length - 1];
  const kindCounts = new Map();
  for (const item of items) {
    const k = KIND_LABELS[item.kind] || item.kind;
    kindCounts.set(k, (kindCounts.get(k) || 0) + 1);
  }
  const kindSummary = [...kindCounts.entries()]
    .map(([k, n]) => n > 1 ? `${n}× ${k}` : k).join(', ');
  const timeRange  = first.displayTime === last.displayTime
    ? first.displayTime : `${first.displayTime}–${last.displayTime}`;
  const mergedId   = 'mg_' + Math.random().toString(36).slice(2, 9);
  return {
    _type: 'event', _group: items, _mergedId: mergedId,
    _kindSummary: kindSummary, _timeRange: timeRange,
    sortKey: first.sortKey, displayTime: first.displayTime,
    source: first.source, repoOrChannel: first.repoOrChannel,
    id: mergedId, kind: first.kind, title: `${items.length} events`, url: null, raw: first.raw,
  };
}

// Build activity column layout: group events by minute, resolve overlaps.
// Returns { positions: [{min, top, groups}], totalHeight }
function buildActivityLayout(eventItems, startMin) {
  const byMinute = new Map();
  for (const item of eventItems) {
    const min = timeToMinutesOfDay(item.displayTime);
    if (!byMinute.has(min)) byMinute.set(min, []);
    byMinute.get(min).push(item);
  }

  const sorted = [...byMinute.keys()].sort((a, b) => a - b);
  const positions = [];
  let currentBottom = 0;

  for (const min of sorted) {
    const items = byMinute.get(min);
    const idealTop = (min - startMin) * PX_PER_MIN;
    const actualTop = Math.max(idealTop, currentBottom);

    // Group by repoOrChannel for compaction
    const groupMap = new Map();
    for (const item of items) {
      const key = item.repoOrChannel || '?';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(item);
    }
    const groups = [...groupMap.values()];

    let bucketH = 4; // bottom gap
    for (const g of groups) {
      bucketH += g.length > 2 ? COMPACT_H : g.length * EVENT_H;
    }

    positions.push({ min, top: actualTop, groups });
    currentBottom = actualTop + bucketH;
  }

  return { positions, totalHeight: currentBottom };
}

function renderActivityColumn(positions, addedSet) {
  if (!positions.length) return '<div class="act-empty">No activity for the selected filters.</div>';
  let html = '';
  for (const { top, groups } of positions) {
    html += `<div class="act-bucket" style="top:${top}px">`;
    for (const group of groups) {
      for (const item of group) {
        html += item._group ? renderMergedGroupRow(item, addedSet) : renderTimelineRow(item, addedSet);
      }
    }
    html += '</div>';
  }
  return html;
}

function renderCompactGroup(items, addedSet) {
  const first = items[0];
  const proj = projectFor(first.raw);
  const anyAdded = items.some((i) => addedSet.has(i.id));

  // Summarise kinds: "3× commit, approved"
  const kindCounts = new Map();
  for (const item of items) {
    const k = KIND_LABELS[item.kind] || item.kind;
    kindCounts.set(k, (kindCounts.get(k) || 0) + 1);
  }
  const kindSummary = [...kindCounts.entries()]
    .map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join(', ');

  // Most common issue key from titles
  const issueKeys = items.map((i) => extractIssueKey(i.title) || extractIssueKey(i.branch)).filter(Boolean);
  const topKey = issueKeys.length ? issueKeys.sort((a, b) =>
    issueKeys.filter((x) => x === b).length - issueKeys.filter((x) => x === a).length)[0] : null;

  const ids = items.map((i) => i.id).join(',');

  return `
    <div class="event event-compact${anyAdded ? ' added' : ''}" data-compact-ids="${escapeHtml(ids)}" data-source="${first.source}" title="Click to add all to Tempo log">
      <span class="time">${escapeHtml(first.displayTime)}</span>
      <span class="badge ${first.source}">${escapeHtml(kindSummary)}</span>
      <div>
        <div class="title">${ctxHtml(first.source, first.repoOrChannel)}${topKey ? ` <span class="logged-tag" style="opacity:.7">${escapeHtml(topKey)}</span>` : ''}</div>
        <div class="meta"><span class="cmp-count">${items.length} events</span></div>
      </div>
      <span class="${proj ? 'proj has' : 'proj miss'}">${escapeHtml(proj || '?')}</span>
    </div>`;
}

function renderMergedGroupRow(item, addedSet) {
  const anyAdded    = item._group.some((i) => addedSet.has(i.id));
  const addedCount  = item._group.filter((i) => addedSet.has(i.id)).length;
  const proj        = projectFor(item.raw);
  const issueKeys   = item._group.map((i) => extractIssueKey(i.title) || extractIssueKey(i.branch)).filter(Boolean);
  const topKey      = issueKeys.length ? issueKeys.sort((a, b) =>
    issueKeys.filter((x) => x === b).length - issueKeys.filter((x) => x === a).length)[0] : null;
  const countLabel  = addedCount > 0 ? `${addedCount}/${item._group.length}` : String(item._group.length);

  return `
    <div class="event event-merged${anyAdded ? ' added' : ''}" data-merged-id="${escapeHtml(item._mergedId)}" data-source="${item.source}">
      <span class="time">${escapeHtml(item._timeRange)}</span>
      <span class="badge ${item.source}">${escapeHtml(item._kindSummary)}</span>
      <div>
        <div class="title">${ctxHtml(item.source, item.repoOrChannel)}${topKey ? ` <span class="logged-tag" style="opacity:.7">${escapeHtml(topKey)}</span>` : ''}</div>
        <div class="meta"><span class="cmp-count">${countLabel} events</span></div>
      </div>
      <span class="${proj ? 'proj has' : 'proj miss'}">${escapeHtml(proj || '?')}</span>
    </div>`;
}

function addCompactGroupToTempo(rawEvents) {
  if (!state.selected || !rawEvents.length) return;
  const list = entriesForDay();
  for (const ev of rawEvents) {
    const proj = projectFor(ev);
    const keyFromTitle = extractIssueKey(ev.title) || extractIssueKey(ev.branch);
    const issueKey = keyFromTitle || (proj ? `${proj}-` : '');
    const description = buildDescription(ev);
    const existingIdx = list.findIndex((e) => e.issueKey && issueKey && e.issueKey === issueKey);
    if (existingIdx >= 0) {
      const e = list[existingIdx];
      e.timeSeconds = (parseInt(e.timeSeconds, 10) || 0) + 15 * 60;
      if (!e.description.includes(description)) {
        e.description = e.description ? `${e.description}; ${description}` : description;
      }
      e.sourceIds = Array.from(new Set([...(e.sourceIds || []), String(ev.id)]));
    } else {
      list.push({ id: cryptoId(), issueKey, timeSeconds: 30 * 60, description, sourceIds: [String(ev.id)] });
    }
  }
  saveTempo();
  renderTempo();
  renderDay();
}

function renderTimeGrid(startMin, endMin) {
  let html = '';
  const firstH = Math.max(Math.ceil(startMin / 60), GRID_START / 60);
  const lastH  = Math.min(Math.floor(endMin / 60),  GRID_END  / 60);
  for (let h = firstH; h <= lastH; h++) {
    const top = (h * 60 - startMin) * PX_PER_MIN;
    html += `<div class="tg-line" style="top:${top}px"></div>`;
  }
  return html;
}

function renderTempoColumn(worklogs, draftEntries, calMeetings, addedSet, startMin, endMin) {
  let html = '';
  // Hour labels
  const firstH = Math.max(Math.ceil(startMin / 60), GRID_START / 60);
  const lastH  = Math.min(Math.floor(endMin / 60),  GRID_END  / 60);
  for (let h = firstH; h <= lastH; h++) {
    const top = (h * 60 - startMin) * PX_PER_MIN;
    html += `<div class="tb-label" style="top:${top}px">${pad(h)}:00</div>`;
  }
  // Build set of meeting IDs already covered by a draft (to avoid double-rendering)
  const meetingDraftMap = new Map(); // meetingId → draft entry
  for (const e of (draftEntries || [])) {
    for (const sid of (e.sourceIds || [])) {
      if (calMeetings.some((m) => m.id === sid)) meetingDraftMap.set(sid, e);
    }
  }

  // Meeting blocks (calendar events with duration, rendered behind worklog blocks)
  for (const m of calMeetings) {
    if (!m.duration || m.kind === 'event-all-day') continue;
    if (meetingDraftMap.has(m.id)) continue; // shown as part of the draft block below
    const startM   = timeToMinutesOfDay(m.displayTime);
    const top      = (startM - startMin) * PX_PER_MIN;
    const height   = Math.max(m.duration / 60 * PX_PER_MIN, 20);
    const showTitle = height > 36;
    html += `<div class="wb-meeting" data-meeting-id="${escapeHtml(m.id)}" style="top:${top}px;height:${height}px" title="${escapeHtml(m.title)}">
      ${showTitle ? `<span class="wb-meeting-title">${escapeHtml(m.title.slice(0, 40))}</span>` : ''}
      <span class="wb-dur">${formatDuration(m.duration)}</span>
    </div>`;
  }
  // Real Tempo worklog blocks
  for (const w of [...worklogs].sort((a, b) => a.displayTime.localeCompare(b.displayTime))) {
    const startM   = timeToMinutesOfDay(w.displayTime);
    const durMin   = w.duration / 60;
    const top      = (startM - startMin) * PX_PER_MIN;
    const height   = Math.max(durMin * PX_PER_MIN, 28);
    const showDesc = height > 52 && w.description;
    html += `<div class="wb-block" data-wl-id="${escapeHtml(String(w.raw?.id ?? ''))}" style="top:${top}px;height:${height}px">
      <span class="wb-key">${escapeHtml(w.issueKey || '?')}</span>
      <span class="wb-dur">${formatDuration(w.duration)}</span>
      ${showDesc ? `<span class="wb-desc">${escapeHtml(w.description.slice(0, 60))}</span>` : ''}
      <div class="wb-resize-handle"></div>
    </div>`;
  }
  // Draft entries that have a startTime (created by drag-to-create or from a meeting)
  for (const e of (draftEntries || []).filter((e) => e.startTime)) {
    const startM      = timeToMinutesOfDay(e.startTime);
    const top         = (startM - startMin) * PX_PER_MIN;
    const height      = Math.max((parseInt(e.timeSeconds, 10) || 0) / 60 * PX_PER_MIN, 28);
    const srcMeeting  = calMeetings.find((m) => (e.sourceIds || []).includes(m.id));
    html += `<div class="wb-block wb-draft" data-draft-id="${escapeHtml(e.id)}" style="top:${top}px;height:${height}px">
      ${srcMeeting ? `<span class="wb-meeting-title">${escapeHtml(srcMeeting.title.slice(0, 40))}</span>` : ''}
      <span class="wb-key">${escapeHtml(e.issueKey || '…')}</span>
      <span class="wb-dur">${formatDuration(parseInt(e.timeSeconds, 10) || 0)}</span>
      <div class="wb-resize-handle"></div>
    </div>`;
  }
  return html;
}

function pixelToTime(y, startMin) {
  return Math.round(Math.max(0, Math.min(23 * 60 + 45, startMin + y / PX_PER_MIN)) / 15) * 15;
}

function wireTempoColumnDrag(colEl, startMin) {
  const hoverLine = document.createElement('div');
  hoverLine.className = 'tc-hover-line';
  colEl.appendChild(hoverLine);

  colEl.addEventListener('mousemove', (e) => {
    if (e.buttons !== 0) return;
    if (e.target.closest('.wb-block')) { hoverLine.style.display = 'none'; return; }
    const y = e.clientY - colEl.getBoundingClientRect().top;
    const t = pixelToTime(y, startMin);
    hoverLine.dataset.time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    hoverLine.style.cssText = `display:block; top:${(t - startMin) * PX_PER_MIN}px`;
  });

  colEl.addEventListener('mouseleave', () => { hoverLine.style.display = 'none'; });

  colEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.wb-block') || e.target.closest('.tb-label')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const colRect   = colEl.getBoundingClientRect();
    const rawY      = e.clientY - colRect.top;
    const startTimeMin = pixelToTime(rawY, startMin);
    const anchorY   = (startTimeMin - startMin) * PX_PER_MIN;

    hoverLine.style.display = 'none';

    const ghost = document.createElement('div');
    ghost.className = 'wb-ghost';
    ghost.style.cssText = `top:${anchorY}px; height:${Math.round(60 * PX_PER_MIN)}px`;
    ghost.innerHTML = `<span class="wb-key">${pad(Math.floor(startTimeMin / 60))}:${pad(startTimeMin % 60)}</span><span class="wb-dur">1h</span>`;
    colEl.appendChild(ghost);

    const onMove = (ev) => {
      const curY = ev.clientY - colRect.top;
      const dy   = Math.max(curY - anchorY, 15 * PX_PER_MIN);
      ghost.style.height = `${dy}px`;
      const durMin = Math.max(15, Math.round(dy / PX_PER_MIN / 15) * 15);
      ghost.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost.remove();

      const dy = ev.clientY - colRect.top - anchorY;
      const durSeconds = dy < 10
        ? 3600
        : Math.max(15, Math.round(dy / PX_PER_MIN / 15) * 15) * 60;

      entriesForDay().push({
        id: cryptoId(),
        issueKey: '',
        timeSeconds: durSeconds,
        description: '',
        sourceIds: [],
        startTime: `${pad(Math.floor(startTimeMin / 60))}:${pad(startTimeMin % 60)}:00`,
      });
      saveTempo();
      renderTempo();
      renderDay();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Wire move + resize for real Tempo worklog blocks
  for (const block of colEl.querySelectorAll('.wb-block:not(.wb-draft)[data-wl-id]')) {
    const wlId = block.dataset.wlId;

    block.querySelector('.wb-resize-handle').addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startY      = e.clientY;
      const startHeight = block.offsetHeight;

      const onMove = (ev) => {
        const newH   = Math.max(15 * PX_PER_MIN, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / PX_PER_MIN / 15) * 15);
        block.style.height = `${durMin * PX_PER_MIN}px`;
        block.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
      };

      const onUp = async (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const newH     = Math.max(15 * PX_PER_MIN, startHeight + ev.clientY - startY);
        const durMin   = Math.max(15, Math.round(newH / PX_PER_MIN / 15) * 15);
        const newSec   = durMin * 60;
        const wl       = state.worklogs.find((w) => String(w.id) === wlId);
        if (!wl) return;
        const oldSec   = wl.timeSpentSeconds;
        wl.timeSpentSeconds = newSec;
        block.classList.add('wb-saving');
        try {
          await api(`/api/tempo/worklog/${encodeURIComponent(wlId)}`, {
            method: 'PUT',
            body: JSON.stringify({ issueId: wl.issueId, startDate: wl.startDate, startTime: wl.startTime, timeSeconds: newSec, description: wl.description }),
          });
          loadWorklogs({ refresh: true }).then(() => { renderWeeklySummary(); renderDay(); });
        } catch (err) {
          wl.timeSpentSeconds = oldSec;
          renderDay();
          toast(`Tempo update failed: ${err.message}`, 'err');
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wb-resize-handle')) return;
      e.stopPropagation();
      e.preventDefault();
      const colRect = colEl.getBoundingClientRect();
      const offsetY = e.clientY - colRect.top - parseFloat(block.style.top || 0);

      const onMove = (ev) => {
        const t = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin);
        block.style.top = `${(t - startMin) * PX_PER_MIN}px`;
        block.querySelector('.wb-key').textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      };

      const onUp = async (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const t          = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin);
        const newTime    = `${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`;
        const wl         = state.worklogs.find((w) => String(w.id) === wlId);
        if (!wl) return;
        const oldTime    = wl.startTime;
        wl.startTime     = newTime;
        block.classList.add('wb-saving');
        try {
          await api(`/api/tempo/worklog/${encodeURIComponent(wlId)}`, {
            method: 'PUT',
            body: JSON.stringify({ issueId: wl.issueId, startDate: wl.startDate, startTime: newTime, timeSeconds: wl.timeSpentSeconds, description: wl.description }),
          });
          loadWorklogs({ refresh: true }).then(() => { renderWeeklySummary(); renderDay(); });
        } catch (err) {
          wl.startTime = oldTime;
          renderDay();
          toast(`Tempo update failed: ${err.message}`, 'err');
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Wire move + resize for already-rendered draft blocks
  for (const block of colEl.querySelectorAll('.wb-block.wb-draft[data-draft-id]')) {
    const entryId = block.dataset.draftId;

    // Resize — drag the bottom handle
    block.querySelector('.wb-resize-handle').addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const entry = (state.tempoByDay[state.selected] || []).find((x) => x.id === entryId);
      if (!entry) return;

      const startY      = e.clientY;
      const startHeight = block.offsetHeight;

      const onMove = (ev) => {
        const newH   = Math.max(15 * PX_PER_MIN, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / PX_PER_MIN / 15) * 15);
        block.style.height = `${durMin * PX_PER_MIN}px`;
        block.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const newH   = Math.max(15 * PX_PER_MIN, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / PX_PER_MIN / 15) * 15);
        entry.timeSeconds = durMin * 60;
        saveTempo();
        renderTempo();
        renderDay();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Move — drag the block body
    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wb-resize-handle')) return;
      e.stopPropagation();
      e.preventDefault();
      const entry = (state.tempoByDay[state.selected] || []).find((x) => x.id === entryId);
      if (!entry) return;

      const colRect = colEl.getBoundingClientRect();
      const offsetY = e.clientY - colRect.top - parseFloat(block.style.top || 0);

      const onMove = (ev) => {
        const t       = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin);
        block.style.top = `${(t - startMin) * PX_PER_MIN}px`;
        block.querySelector('.wb-key').textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const t = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin);
        entry.startTime = `${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`;
        saveTempo();
        renderTempo();
        renderDay();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ---------- Compact group popup ----------
function showCompactPopup(items, anchorEl, addedSet, allEvents, hoverMode = false) {
  document.getElementById('compact-popup')?.remove();

  const first = items[0];
  const popup = document.createElement('div');
  popup.id = 'compact-popup';
  popup.className = 'compact-popup';

  let rows = '';
  for (const item of items) {
    const kind = KIND_LABELS[item.kind] || item.kind;
    const added = addedSet.has(item.id);
    rows += `<div class="cmpop-row${added ? ' added' : ''}" data-id="${item.id}">
      <span class="cmpop-time">${escapeHtml(item.displayTime)}</span>
      <span class="badge ${item.source}">${escapeHtml(kind)}</span>
      <span class="cmpop-title">${escapeHtml(item.title || '(no title)')}</span>
    </div>`;
  }

  popup.innerHTML = `
    <div class="cmpop-head">
      ${ctxHtml(first.source, first.repoOrChannel)}
      <button class="cmpop-close" id="cmpop-close">×</button>
    </div>
    <div class="cmpop-list">${rows}</div>
    <div class="cmpop-foot">
      <button id="cmpop-add-all" class="primary">Add all to Tempo</button>
    </div>`;

  // Position below anchor, clamped to viewport
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 490)}px`;
  popup.style.top  = `${Math.min(rect.bottom + 4, window.innerHeight - 440)}px`;

  document.body.appendChild(popup);

  if (hoverMode) {
    let dismissTimer;
    const scheduleHide = () => { dismissTimer = setTimeout(() => popup.remove(), 160); };
    const cancelHide   = () => clearTimeout(dismissTimer);
    anchorEl.addEventListener('mouseleave', scheduleHide);
    popup.addEventListener('mouseenter', cancelHide);
    popup.addEventListener('mouseleave', scheduleHide);
  }

  for (const row of popup.querySelectorAll('.cmpop-row')) {
    row.addEventListener('click', () => {
      const ev = allEvents.find((e) => String(e.id) === row.dataset.id);
      if (ev) addEventToTempo(ev);
      popup.remove();
    });
  }

  popup.querySelector('#cmpop-add-all').addEventListener('click', () => {
    const evs = items.map((i) => allEvents.find((e) => String(e.id) === i.id)).filter(Boolean);
    if (evs.length) addCompactGroupToTempo(evs);
    popup.remove();
  });

  popup.querySelector('#cmpop-close').addEventListener('click', () => popup.remove());

  const onOutside = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorEl) {
      popup.remove();
      document.removeEventListener('click', onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);

  const onEsc = (e) => {
    if (e.key === 'Escape') { popup.remove(); document.removeEventListener('keydown', onEsc); }
  };
  document.addEventListener('keydown', onEsc);
}

// ---------- Issue autocomplete ----------
let _issueDropdown = null;

function closeIssueDropdown() {
  _issueDropdown?.remove();
  _issueDropdown = null;
}

function getRecentIssues(limit = 8) {
  const byKey = new Map();
  for (const w of state.worklogs) {
    if (!w.issueKey) continue;
    const cur = byKey.get(w.issueKey) || { issueKey: w.issueKey, count: 0, lastDate: '', lastDescription: '' };
    cur.count++;
    if (w.startDate > cur.lastDate) {
      cur.lastDate = w.startDate;
      cur.lastDescription = w.description || '';
    }
    byKey.set(w.issueKey, cur);
  }
  return [...byKey.values()]
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count)
    .slice(0, limit);
}

function showIssueDropdown(input, items, headerText) {
  closeIssueDropdown();
  if (!items.length) return;

  const dd = document.createElement('div');
  dd.className = 'issue-dropdown';
  _issueDropdown = dd;

  let html = `<div class="io-header">${escapeHtml(headerText)}</div>`;
  for (const item of items) {
    html += `<div class="io-item" data-key="${escapeHtml(item.issueKey)}">
      <span class="io-key">${escapeHtml(item.issueKey)}</span>
      <span class="io-info">${escapeHtml(item.lastDescription || '')}</span>
    </div>`;
  }
  dd.innerHTML = html;

  const rect = input.getBoundingClientRect();
  dd.style.left     = `${rect.left}px`;
  dd.style.top      = `${rect.bottom + 2}px`;
  dd.style.minWidth = `${rect.width}px`;

  document.body.appendChild(dd);

  for (const row of dd.querySelectorAll('.io-item')) {
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      input.value = row.dataset.key;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeIssueDropdown();
    });
  }
}

function wireIssueInput(input, entry) {
  let debounceTimer = null;
  let activeIdx = -1;

  function ddItems() {
    return _issueDropdown ? [..._issueDropdown.querySelectorAll('.io-item')] : [];
  }
  function setActive(idx) {
    ddItems().forEach((el, i) => el.classList.toggle('io-active', i === idx));
    activeIdx = idx;
  }

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) {
      const recent = getRecentIssues(8);
      if (recent.length) showIssueDropdown(input, recent, 'Recent issues');
    }
  });

  input.addEventListener('input', (e) => {
    entry.issueKey = e.target.value.toUpperCase().trim();
    saveTempo();
    renderWeeklySummary();
    activeIdx = -1;

    const q = input.value.trim();
    if (q.length < 2) {
      const recent = getRecentIssues(8);
      if (recent.length) showIssueDropdown(input, recent, 'Recent issues');
      else closeIssueDropdown();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (_issueDropdown) _issueDropdown.querySelector('.io-header').textContent = 'Searching…';
      try {
        const results = await api(`/api/jira/search?q=${encodeURIComponent(q)}`);
        if (document.activeElement === input) {
          showIssueDropdown(
            input,
            results.map((r) => ({ issueKey: r.key, lastDescription: r.summary || '' })),
            'Search results',
          );
        }
      } catch { closeIssueDropdown(); }
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    const items = ddItems();
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const key = items[activeIdx].dataset.key;
      input.value = key;
      entry.issueKey = key;
      saveTempo();
      renderWeeklySummary();
      closeIssueDropdown();
    } else if (e.key === 'Escape') { closeIssueDropdown(); }
  });

  input.addEventListener('blur', () => setTimeout(closeIssueDropdown, 150));
}

function renderDay() {
  const titleEl  = document.getElementById('day-title');
  const countsEl = document.getElementById('day-counts');
  const content  = document.getElementById('day-content');

  if (!state.selected) {
    titleEl.textContent = 'Select a day';
    countsEl.innerHTML  = '';
    const hoursElInit = document.getElementById('day-hours');
    if (hoursElInit) hoursElInit.innerHTML = '';
    content.innerHTML   = '<div class="empty">No day selected.</div>';
    return;
  }

  titleEl.textContent = dayLong(state.selected);

  const { items, counts } = buildDayTimeline(state.selected);
  const worklogs    = items.filter((i) => i._type === 'worklog');
  const loggedTotal = worklogs.reduce((s, w) => s + w.duration, 0);
  countsEl.innerHTML = renderFilterChips(counts);

  // Hours badge (top-right of day-head)
  const hoursEl = document.getElementById('day-hours');
  if (hoursEl) {
    const TARGET = 8 * 3600;
    if (!loggedTotal) {
      hoursEl.className = 'day-hours-badge hours-none';
      hoursEl.innerHTML = `<span class="day-hours-num">—</span><span class="day-hours-label">nothing logged</span>`;
    } else {
      const ok   = loggedTotal >= TARGET;
      const diff = Math.abs(TARGET - loggedTotal);
      hoursEl.className = `day-hours-badge ${ok ? 'hours-ok' : 'hours-warn'}`;
      hoursEl.innerHTML = `<span class="day-hours-num">${formatDuration(loggedTotal)}</span>
        <span class="day-hours-label">${ok ? '✓ on track' : `↓ ${formatDuration(diff)} short`}</span>`;
    }
  }

  const tempoEntries = state.tempoByDay[state.selected] || [];
  const addedSet = new Set(tempoEntries.flatMap((e) => e.sourceIds || []));

  if (items.length === 0) {
    content.innerHTML = '<div class="empty">No activity recorded for this day.</div>';
    return;
  }

  // Calendar meetings shown in Tempo column regardless of filter state
  const calMeetings = items.filter((i) => i._type === 'event' && i.source === 'calendar' && i.kind !== 'event-all-day' && i.duration > 0);

  // Compute shared time range (at minimum 9:00–20:00)
  let contentStart = GRID_START;
  let contentEnd   = GRID_END;
  for (const item of items) {
    const min = timeToMinutesOfDay(item.displayTime);
    if (min > 0) {
      contentStart = Math.min(contentStart, Math.floor(min / 60) * 60);
      const hasDuration = item._type === 'worklog' || (item.source === 'calendar' && item.duration > 0);
      contentEnd = Math.max(contentEnd,
        hasDuration
          ? Math.ceil((min + item.duration / 60) / 60) * 60
          : Math.ceil((min + 30) / 60) * 60);
    }
  }
  const startMin = Math.min(contentStart, GRID_START);
  const endMin   = Math.max(contentEnd,   GRID_END);

  // Build activity column layout — merge nearby items in same source+channel first
  const rawEventItems = items.filter((i) => i._type === 'event' && timelineFilters.has(i.source));
  const eventItems    = mergeNearbyItems(rawEventItems);
  const { positions, totalHeight: actH } = buildActivityLayout(eventItems, startMin);

  const containerH = Math.max((endMin - startMin) * PX_PER_MIN, actH);

  const draftEntries = state.tempoByDay[state.selected] || [];

  content.innerHTML = `
    <div class="day-two-col" style="height:${containerH}px">
      <div class="day-time-grid">${renderTimeGrid(startMin, endMin)}</div>
      <div class="day-activity-col">${renderActivityColumn(positions, addedSet)}</div>
      <div class="day-tempo-col">${renderTempoColumn(worklogs, draftEntries, calMeetings, addedSet, startMin, endMin)}</div>
    </div>`;

  wireTempoColumnDrag(content.querySelector('.day-tempo-col'), startMin);

  // Wire individual event clicks
  const allEvents = [
    ...state.events.github.filter((e) => localDay(e.time) === state.selected),
    ...state.events.slack.filter((e) => localDay(e.time) === state.selected),
    ...(state.events.calendar || []).filter((e) => localDay(e.time) === state.selected),
    ...(state.events.email    || []).filter((e) => localDay(e.time) === state.selected),
  ];
  for (const node of content.querySelectorAll('.event[data-id]')) {
    node.addEventListener('click', () => {
      const ev = allEvents.find((x) => String(x.id) === node.dataset.id);
      if (ev) addEventToTempo(ev);
    });
  }

  // Wire meeting block clicks → log matching duration + start time
  for (const block of content.querySelectorAll('.wb-meeting[data-meeting-id]')) {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = calMeetings.find((m) => m.id === block.dataset.meetingId);
      if (item) addMeetingToTempo(item);
    });
  }

  // Wire merged group hover → popup with individual items
  const mergedGroupMap = new Map();
  for (const item of eventItems) {
    if (item._group) mergedGroupMap.set(item._mergedId, item);
  }
  let mergeHoverTimer;
  for (const node of content.querySelectorAll('[data-merged-id]')) {
    const mergedItem = mergedGroupMap.get(node.dataset.mergedId);
    if (!mergedItem) continue;
    node.addEventListener('mouseenter', () => {
      clearTimeout(mergeHoverTimer);
      mergeHoverTimer = setTimeout(() => {
        document.getElementById('compact-popup')?.remove();
        showCompactPopup(mergedItem._group, node, addedSet, allEvents, true);
      }, 180);
    });
    node.addEventListener('mouseleave', () => clearTimeout(mergeHoverTimer));
  }

  // Wire filter chip clicks
  for (const chip of countsEl.querySelectorAll('.filter-chip')) {
    chip.addEventListener('click', () => {
      const src = chip.dataset.source;
      timelineFilters.has(src) ? timelineFilters.delete(src) : timelineFilters.add(src);
      renderDay();
    });
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Tempo log ----------
function entriesForDay() {
  return (state.tempoByDay[state.selected] ||= []);
}

function addEventToTempo(ev) {
  if (!state.selected) return;
  const list = entriesForDay();
  const proj = projectFor(ev);
  // Try to extract Jira-like key from commit/PR title.
  const keyFromTitle = extractIssueKey(ev.title) || extractIssueKey(ev.branch);
  const issueKey = keyFromTitle || (proj ? `${proj}-` : '');
  const description = buildDescription(ev);

  // If a row exists with same issueKey, append description and bump time
  const existingIdx = list.findIndex((e) => e.issueKey && issueKey && e.issueKey === issueKey);
  if (existingIdx >= 0) {
    const e = list[existingIdx];
    e.timeSeconds = (parseInt(e.timeSeconds, 10) || 0) + 15 * 60;
    if (!e.description.includes(description)) {
      e.description = e.description ? `${e.description}; ${description}` : description;
    }
    e.sourceIds = Array.from(new Set([...(e.sourceIds || []), String(ev.id)]));
  } else {
    list.push({
      id: cryptoId(),
      issueKey,
      timeSeconds: 30 * 60,
      description,
      sourceIds: [String(ev.id)],
    });
  }
  saveTempo();
  renderTempo();
  renderDay();
}

function addMeetingToTempo(item) {
  if (!state.selected) return;
  const list = entriesForDay();
  if (list.some((e) => (e.sourceIds || []).includes(item.id))) return; // already added
  const proj = projectFor(item.raw);
  const keyFromTitle = extractIssueKey(item.title);
  const issueKey = keyFromTitle || (proj ? `${proj}-` : '');
  list.push({
    id: cryptoId(),
    issueKey,
    timeSeconds: item.duration,
    description: item.title || '',
    sourceIds: [item.id],
    startTime: item.displayTime + ':00',
  });
  saveTempo();
  renderTempo();
  renderDay();
}

function extractIssueKey(text) {
  if (!text) return null;
  const m = String(text).match(/\b([A-Z][A-Z0-9]+)-(\d+)\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function buildDescription(ev) {
  if (ev.source === 'github') {
    if (ev.kind === 'commit') return ev.title;
    const lbl = KIND_LABELS[ev.kind] || ev.kind;
    if (ev.prNumber) return `${lbl}: ${ev.title} (#${ev.prNumber})`;
    if (ev.branch && ev.kind === 'branch-created') return `branch ${ev.branch}`;
    return `${lbl}: ${ev.title}`;
  }
  if (ev.source === 'slack') {
    return `Slack #${ev.repoOrChannel}: ${ev.title}`;
  }
  return ev.title || '';
}

function cryptoId() {
  return 'e_' + Math.random().toString(36).slice(2, 10);
}

function renderTempo() {
  const list = document.getElementById('tempo-list');
  const totalEl = document.getElementById('tempo-total');
  list.innerHTML = '';

  if (!state.selected) {
    totalEl.textContent = '';
    list.innerHTML = '<li class="muted small">Select a day first.</li>';
    return;
  }

  const entries = entriesForDay();
  const total = entries.reduce((s, e) => s + (parseInt(e.timeSeconds, 10) || 0), 0);
  totalEl.textContent = entries.length ? `Σ ${formatDuration(total)}` : '';

  if (entries.length === 0) {
    list.innerHTML = '<li class="muted small">Click an event on the left to add it, or use “+ Empty entry”.</li>';
    return;
  }

  for (const entry of entries) {
    const li = document.createElement('li');
    li.dataset.id = entry.id;
    li.innerHTML = `
      <div class="tempo-row">
        <div class="issue-wrap"><input name="issue" placeholder="ISSUE-123" value="${escapeHtml(entry.issueKey)}" autocomplete="off" /></div>
        <input name="time" placeholder="1h 30m" value="${formatDuration(entry.timeSeconds)}" />
        <button class="remove" title="Remove">×</button>
      </div>
      <div class="tempo-row full">
        <textarea name="desc" rows="2" placeholder="Description">${escapeHtml(entry.description)}</textarea>
      </div>
    `;
    wireIssueInput(li.querySelector('input[name="issue"]'), entry);
    li.querySelector('input[name="time"]').addEventListener('change', (e) => {
      const sec = parseDuration(e.target.value);
      entry.timeSeconds = sec;
      e.target.value = formatDuration(sec);
      saveTempo();
      renderTempo();
    });
    li.querySelector('textarea[name="desc"]').addEventListener('input', (e) => {
      entry.description = e.target.value;
      saveTempo();
    });
    li.querySelector('.remove').addEventListener('click', () => {
      const arr = entriesForDay();
      const idx = arr.findIndex((x) => x.id === entry.id);
      if (idx >= 0) arr.splice(idx, 1);
      saveTempo();
      renderTempo();
      renderDay();
    });
    list.appendChild(li);
  }
}

// ---------- Favorites ----------
function renderFavorites() {
  const bar = document.getElementById('favorites-bar');
  if (!bar) return;
  if (!state.favorites.length) {
    bar.innerHTML = '<span class="muted small">No favorites yet — click ★ Favorites to add some.</span>';
    return;
  }
  bar.innerHTML = state.favorites.map((f) => {
    const label = f.label || f.issueKey || '?';
    const time = formatDuration(f.timeSeconds || 0);
    const title = `${f.issueKey || '?'} · ${time}${f.description ? ' · ' + f.description : ''}`;
    return `<button class="fav-chip" data-id="${f.id}" title="${escapeHtml(title)}">
      <span class="fav-label">${escapeHtml(label)}</span>
      <span class="fav-time">${escapeHtml(time)}</span>
    </button>`;
  }).join('');
  for (const node of bar.querySelectorAll('.fav-chip')) {
    node.addEventListener('click', () => {
      const fav = state.favorites.find((f) => f.id === node.dataset.id);
      if (fav) addFavoriteToDay(fav);
    });
  }
}

function addFavoriteToDay(fav) {
  if (!state.selected) { toast('Select a day first.', 'err'); return; }
  if (!fav.issueKey) { toast('Favorite has no issue key.', 'err'); return; }
  const list = entriesForDay();
  const existing = list.find((e) => e.issueKey === fav.issueKey && e.description === (fav.description || ''));
  if (existing) {
    existing.timeSeconds = (parseInt(existing.timeSeconds, 10) || 0) + (parseInt(fav.timeSeconds, 10) || 0);
  } else {
    list.push({
      id: cryptoId(),
      issueKey: fav.issueKey,
      timeSeconds: parseInt(fav.timeSeconds, 10) || 30 * 60,
      description: fav.description || '',
      sourceIds: [],
    });
  }
  saveTempo();
  renderTempo();
  renderWeeklySummary();
  toast(`Added ${fav.issueKey} to ${dayLong(state.selected)}.`, 'ok');
}

function openFavorites() {
  const modal = document.getElementById('favorites-modal');
  modal.classList.remove('hidden');
  const draft = state.favorites.map((f) => ({ ...f }));
  modal._draft = draft;
  renderFavoritesTable(draft);
  // Reset suggestions panel
  const sugg = document.getElementById('favorites-suggestions');
  sugg.classList.add('hidden');
  sugg.innerHTML = '';
  document.getElementById('suggest-favorites').onclick = () => loadSuggestions();
}

function closeFavorites() {
  document.getElementById('favorites-modal').classList.add('hidden');
}

async function loadSuggestions() {
  const sugg = document.getElementById('favorites-suggestions');
  sugg.classList.remove('hidden');
  sugg.innerHTML = '<div class="muted small">Loading suggestions…</div>';
  try {
    const data = await api('/api/tempo/suggestions?days=90&limit=15');
    renderSuggestions(data.suggestions || [], data.days || 90);
  } catch (e) {
    sugg.innerHTML = `<div class="feedback err">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderSuggestions(suggestions, days) {
  const sugg = document.getElementById('favorites-suggestions');
  const draft = document.getElementById('favorites-modal')._draft || [];
  const existingKeys = new Set(draft.map((f) => (f.issueKey || '').toUpperCase()));

  if (!suggestions.length) {
    sugg.innerHTML = `<div class="muted small">No worklogs found in the last ${days} days.</div>`;
    return;
  }

  let html = `<div class="sugg-head">Top issues from your last ${days} days — tick the ones to add:</div>`;
  html += '<div class="sugg-list">';
  for (const s of suggestions) {
    const already = existingKeys.has(s.issueKey.toUpperCase());
    html += `
      <label class="sugg-row${already ? ' already' : ''}">
        <input type="checkbox" data-key="${escapeHtml(s.issueKey)}"${already ? ' disabled checked' : ''} />
        <span class="sugg-key">${escapeHtml(s.issueKey)}</span>
        <span class="sugg-stats">${s.count}× · total ${formatDuration(s.totalSeconds)} · avg ${formatDuration(s.avgSeconds)}</span>
        <span class="sugg-desc muted">${escapeHtml(s.topDescription || '')}</span>
      </label>
    `;
  }
  html += '</div>';
  html += '<div class="sugg-foot"><button id="apply-suggestions" class="primary">Add selected</button></div>';
  sugg.innerHTML = html;

  document.getElementById('apply-suggestions').onclick = () => {
    const checks = sugg.querySelectorAll('input[type="checkbox"]:checked:not([disabled])');
    let added = 0;
    for (const c of checks) {
      const s = suggestions.find((x) => x.issueKey === c.dataset.key);
      if (!s) continue;
      // Round avg to a nicer increment (15-min granularity, min 30m).
      const rounded = Math.max(30 * 60, Math.round(s.avgSeconds / (15 * 60)) * 15 * 60);
      draft.push({
        id: cryptoId(),
        issueKey: s.issueKey,
        timeSeconds: rounded,
        description: s.topDescription || '',
        label: '',
      });
      added++;
    }
    if (added === 0) { toast('No new suggestions selected.', 'err'); return; }
    renderFavoritesTable(draft);
    sugg.classList.add('hidden');
    sugg.innerHTML = '';
    toast(`Added ${added} suggestion(s) — review & save.`, 'ok');
  };
}

function renderFavoritesTable(list) {
  const tbody = document.getElementById('favorites-tbody');
  tbody.innerHTML = '';
  list.forEach((f, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input value="${escapeHtml(f.issueKey || '')}" placeholder="ABC-123" style="text-transform:uppercase; font-family:'JetBrains Mono', ui-monospace, monospace;"></td>
      <td><input value="${formatDuration(f.timeSeconds || 0)}" placeholder="1h" style="width:70px"></td>
      <td><input value="${escapeHtml(f.description || '')}" placeholder="Description"></td>
      <td><input value="${escapeHtml(f.label || '')}" placeholder="(optional)"></td>
      <td><button class="del" title="Remove">×</button></td>
    `;
    const inputs = tr.querySelectorAll('input');
    inputs[0].addEventListener('input', (e) => { list[i].issueKey = e.target.value.trim().toUpperCase(); });
    inputs[1].addEventListener('change', (e) => {
      list[i].timeSeconds = parseDuration(e.target.value);
      e.target.value = formatDuration(list[i].timeSeconds);
    });
    inputs[2].addEventListener('input', (e) => { list[i].description = e.target.value; });
    inputs[3].addEventListener('input', (e) => { list[i].label = e.target.value.trim(); });
    tr.querySelector('.del').addEventListener('click', () => {
      list.splice(i, 1);
      renderFavoritesTable(list);
    });
    tbody.appendChild(tr);
  });
  document.getElementById('add-favorite').onclick = () => {
    list.push({ id: cryptoId(), issueKey: '', timeSeconds: 30 * 60, description: '', label: '' });
    renderFavoritesTable(list);
  };
  document.getElementById('save-favorites').onclick = () => {
    state.favorites = list
      .filter((f) => f.issueKey && /^[A-Z][A-Z0-9]+-\d+$/.test(f.issueKey))
      .map((f) => ({
        id: f.id || cryptoId(),
        issueKey: f.issueKey,
        timeSeconds: parseInt(f.timeSeconds, 10) || 30 * 60,
        description: f.description || '',
        label: f.label || '',
      }));
    saveFavorites();
    renderFavorites();
    closeFavorites();
    toast('Favorites saved.', 'ok');
  };
}

function tempoToText() {
  if (!state.selected) return '';
  const entries = entriesForDay();
  if (!entries.length) return '';
  const lines = [`# ${dayLong(state.selected)}`];
  for (const e of entries) {
    lines.push(`${e.issueKey || '(no key)'}\t${formatDuration(e.timeSeconds)}\t${e.description || ''}`);
  }
  const total = entries.reduce((s, e) => s + (parseInt(e.timeSeconds, 10) || 0), 0);
  lines.push(`# Total: ${formatDuration(total)}`);
  return lines.join('\n');
}

async function copyTempo() {
  const text = tempoToText();
  if (!text) { toast('Nothing to copy.', 'err'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.', 'ok');
  } catch {
    toast('Clipboard blocked.', 'err');
  }
}

async function sendTempo() {
  if (!state.selected) return;
  const entries = entriesForDay();
  if (!entries.length) { toast('Nothing to send.', 'err'); return; }
  if (!state.health.config.tempo) { toast('Tempo / Jira not configured.', 'err'); return; }

  const invalid = entries.filter((e) => !e.issueKey || !/^[A-Z][A-Z0-9]+-\d+$/.test(e.issueKey) || !e.timeSeconds);
  if (invalid.length) { toast('Some entries are missing a valid issue key or time.', 'err'); return; }

  const fb = document.getElementById('tempo-feedback');
  fb.textContent = 'Sending…';
  fb.className = 'feedback';

  try {
    const res = await api('/api/tempo', {
      method: 'POST',
      body: JSON.stringify({
        date: state.selected,
        entries: entries.map((e) => ({
          issueKey: e.issueKey,
          timeSeconds: e.timeSeconds,
          description: e.description,
          startTime: e.startTime || null,
        })),
      }),
    });
    const ok = res.results.filter((r) => r.ok).length;
    const fail = res.results.length - ok;
    if (fail === 0) {
      fb.textContent = `✓ ${ok} worklog(s) sent.`;
      fb.className = 'feedback ok';
      // Clear the local drafts for this day (they're now in Tempo).
      delete state.tempoByDay[state.selected];
      saveTempo();
      renderTempo();
      renderDay();
      // Refresh real worklogs so the Tempo column and summary update.
      loadWorklogs({ refresh: true }).then(() => { renderWeeklySummary(); renderDay(); });
    } else {
      const errs = res.results.filter((r) => !r.ok).map((r) => `${r.issueKey}: ${r.error}`).join(' · ');
      fb.textContent = `${ok} ok, ${fail} failed → ${errs}`;
      fb.className = 'feedback err';
    }
  } catch (e) {
    fb.textContent = `Error: ${e.message}`;
    fb.className = 'feedback err';
  }
}

// ---------- Settings modal ----------
function updateGoogleStatusUI() {
  const statusEl      = document.getElementById('settings-google-status');
  const connectBtn    = document.getElementById('settings-google-connect');
  const disconnectBtn = document.getElementById('settings-google-disconnect');
  if (!statusEl) return;
  const configured = state.health.config?.google;
  const connected  = state.health.googleConnected;
  if (!configured) {
    statusEl.textContent = 'Enter Client ID + Secret above, then save before connecting.';
    statusEl.className = 'settings-google-status';
  } else if (connected) {
    statusEl.textContent = '✓ Connected';
    statusEl.className = 'settings-google-status ok';
  } else {
    statusEl.textContent = 'Credentials saved — click Connect Google to authorize.';
    statusEl.className = 'settings-google-status warn';
  }
  connectBtn.style.display    = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? ''     : 'none';
}

async function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-feedback').textContent = '';
  updateGoogleStatusUI();
  try {
    const cfg = await api('/api/config');
    document.getElementById('cfg-github-username').value = cfg.GITHUB_USERNAME   || '';
    document.getElementById('cfg-github-token').value    = cfg.GITHUB_TOKEN      || '';
    document.getElementById('cfg-slack-token').value     = cfg.SLACK_TOKEN       || '';
    document.getElementById('cfg-jira-url').value        = cfg.JIRA_BASE_URL     || '';
    document.getElementById('cfg-jira-email').value      = cfg.JIRA_EMAIL        || '';
    document.getElementById('cfg-jira-token').value      = cfg.JIRA_API_TOKEN    || '';
    document.getElementById('cfg-tempo-token').value     = cfg.TEMPO_TOKEN       || '';
    document.getElementById('cfg-google-id').value       = cfg.GOOGLE_CLIENT_ID  || '';
    document.getElementById('cfg-google-secret').value   = cfg.GOOGLE_CLIENT_SECRET || '';
  } catch (e) {
    toast('Could not load config: ' + e.message, 'err');
  }
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const fb = document.getElementById('settings-feedback');
  fb.textContent = 'Saving…';
  fb.className = 'feedback';
  try {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        GITHUB_USERNAME:     document.getElementById('cfg-github-username').value.trim(),
        GITHUB_TOKEN:        document.getElementById('cfg-github-token').value.trim(),
        SLACK_TOKEN:         document.getElementById('cfg-slack-token').value.trim(),
        JIRA_BASE_URL:       document.getElementById('cfg-jira-url').value.trim(),
        JIRA_EMAIL:          document.getElementById('cfg-jira-email').value.trim(),
        JIRA_API_TOKEN:      document.getElementById('cfg-jira-token').value.trim(),
        TEMPO_TOKEN:         document.getElementById('cfg-tempo-token').value.trim(),
        GOOGLE_CLIENT_ID:    document.getElementById('cfg-google-id').value.trim(),
        GOOGLE_CLIENT_SECRET:document.getElementById('cfg-google-secret').value.trim(),
      }),
    });
    await loadHealth();
    updateGoogleStatusUI();
    fb.textContent = '✓ Saved';
    fb.className = 'feedback ok';
  } catch (e) {
    fb.textContent = 'Error: ' + e.message;
    fb.className = 'feedback err';
  }
}

// ---------- Mappings modal ----------
function openMappings() {
  const modal = document.getElementById('mappings-modal');
  modal.classList.remove('hidden');
  renderMappingsTable(state.mappings.slice());
}

function closeMappings() {
  document.getElementById('mappings-modal').classList.add('hidden');
}

function renderMappingsTable(list) {
  const tbody = document.getElementById('mappings-tbody');
  tbody.innerHTML = '';
  const placeholders = {
    github: 'org/repo',
    slack: 'channel-name',
    'slack-dm': 'Display Name',
  };
  list.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select>
        <option value="github"${m.type === 'github' ? ' selected' : ''}>GitHub repo</option>
        <option value="slack"${m.type === 'slack' ? ' selected' : ''}>Slack channel</option>
        <option value="slack-dm"${m.type === 'slack-dm' ? ' selected' : ''}>Slack DM</option>
      </select></td>
      <td><input value="${escapeHtml(m.key)}" placeholder="${placeholders[m.type] || ''}"></td>
      <td><input value="${escapeHtml(m.project)}" placeholder="ABC" style="text-transform:uppercase"></td>
      <td><button class="del" title="Remove">×</button></td>
    `;
    const sel = tr.querySelector('select');
    const inputs = tr.querySelectorAll('input');
    sel.addEventListener('change', (e) => {
      list[i].type = e.target.value;
      inputs[0].placeholder = placeholders[e.target.value] || '';
    });
    inputs[0].addEventListener('input', (e) => { list[i].key = e.target.value.trim(); });
    inputs[1].addEventListener('input', (e) => { list[i].project = e.target.value.trim().toUpperCase(); });
    tr.querySelector('.del').addEventListener('click', () => {
      list.splice(i, 1);
      renderMappingsTable(list);
    });
    tbody.appendChild(tr);
  });
  // Save the working copy on the modal node
  document.getElementById('mappings-modal').dataset.draft = JSON.stringify(list);
  // Replace handler so adding uses the latest list reference
  const addBtn = document.getElementById('add-mapping');
  addBtn.onclick = () => {
    list.push({ type: 'github', key: '', project: '' });
    renderMappingsTable(list);
  };
  document.getElementById('save-mappings').onclick = async () => {
    try {
      await saveMappings(list.filter((m) => m.key && m.project));
      closeMappings();
      renderDay();
      toast('Mappings saved.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  };
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ---------- Navigation ----------
async function shiftMonth(delta) {
  let m = state.month + delta;
  let y = state.year;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.year = y; state.month = m;
  state.selected = null;
  renderCalendar();
  renderDay();
  renderTempo();
  await Promise.all([loadEvents(), loadWorklogs()]);
  renderCalendar();
  pickInitialDay();
}

function selectDay(dStr) {
  state.selected = dStr;
  renderCalendar();
  renderDay();
  renderTempo();
}

function shiftDay(delta) {
  if (!state.selected) {
    selectDay(ymd(new Date()));
    return;
  }
  const [y, m, d] = state.selected.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  if (date.getMonth() + 1 !== state.month || date.getFullYear() !== state.year) {
    state.year = date.getFullYear();
    state.month = date.getMonth() + 1;
    selectDay(ymd(date));
    Promise.all([loadEvents(), loadWorklogs()]).then(() => { renderCalendar(); renderDay(); });
  } else {
    selectDay(ymd(date));
  }
}

function gotoToday() {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth() + 1;
  state.selected = ymd(now);
  renderCalendar();
  renderDay();
  renderTempo();
  Promise.all([loadEvents(), loadWorklogs()]).then(() => { renderCalendar(); renderDay(); });
}

function pickInitialDay() {
  if (state.selected) return;
  const today = ymd(new Date());
  if (state.dayIndex[today]) {
    selectDay(today);
    return;
  }
  // Most recent day with activity in this month
  const days = Object.keys(state.dayIndex).sort();
  if (days.length) selectDay(days[days.length - 1]);
  else renderDay();
}

// ---------- Boot ----------
async function boot() {
  // Wire toolbar
  document.getElementById('prev-month').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => shiftMonth(1));
  document.getElementById('today-btn').addEventListener('click', gotoToday);
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await Promise.all([loadEvents({ refresh: true }), loadWorklogs({ refresh: true })]);
    renderCalendar();
    renderDay();
  });
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-google-connect').addEventListener('click', async () => {
    await saveSettings();
    window.location.href = '/auth/google';
  });
  document.getElementById('settings-google-disconnect').addEventListener('click', async () => {
    await api('/auth/google/disconnect', { method: 'POST' });
    await loadHealth();
    updateGoogleStatusUI();
    toast('Google disconnected.', 'ok');
  });
  document.getElementById('mappings-btn').addEventListener('click', openMappings);
  document.getElementById('mappings-close').addEventListener('click', closeMappings);
  document.getElementById('favorites-btn').addEventListener('click', openFavorites);
  document.getElementById('favorites-close').addEventListener('click', closeFavorites);
  document.getElementById('copy-btn').addEventListener('click', copyTempo);
  document.getElementById('send-btn').addEventListener('click', sendTempo);
  document.getElementById('add-entry').addEventListener('click', () => {
    if (!state.selected) { toast('Select a day first.', 'err'); return; }
    entriesForDay().push({
      id: cryptoId(),
      issueKey: '',
      timeSeconds: 30 * 60,
      description: '',
      sourceIds: [],
    });
    saveTempo();
    renderTempo();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); shiftDay(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); shiftDay(1); }
    else if (e.key.toLowerCase() === 't') { e.preventDefault(); gotoToday(); }
  });

  // Handle Google OAuth redirect params
  const _sp = new URLSearchParams(window.location.search);
  if (_sp.has('google')) {
    toast('Google connected.', 'ok');
    history.replaceState(null, '', window.location.pathname);
  } else if (_sp.has('google_error')) {
    toast('Google error: ' + _sp.get('google_error'), 'err');
    history.replaceState(null, '', window.location.pathname);
  }

  renderCalendar();
  renderDay();
  renderTempo();
  renderFavorites();

  try {
    await Promise.all([loadHealth(), loadMappings()]);
    await Promise.all([loadEvents(), loadWorklogs()]);
    renderCalendar();
    pickInitialDay();
  } catch (e) {
    toast('Boot failed: ' + e.message, 'err');
  }
}

boot();
