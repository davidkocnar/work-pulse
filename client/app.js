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
  events: { github: [], slack: [] },
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
  for (const e of state.events.github) {
    const d = localDay(e.time);
    (idx[d] ||= { gh: 0, sl: 0 }).gh++;
  }
  for (const e of state.events.slack) {
    const d = localDay(e.time);
    (idx[d] ||= { gh: 0, sl: 0 }).sl++;
  }
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
    state.events = { github: data.github || [], slack: data.slack || [] };
    rebuildDayIndex();
    if (data.errors && (data.errors.github || data.errors.slack)) {
      const msgs = [];
      if (data.errors.github) msgs.push(`GitHub: ${data.errors.github}`);
      if (data.errors.slack) msgs.push(`Slack: ${data.errors.slack}`);
      toast(msgs.join(' · '), 'err');
    }
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

  // Local drafts by project
  const drafts = {};
  for (const date of Object.keys(state.tempoByDay)) {
    if (!date.startsWith(monthPrefix)) continue;
    for (const e of state.tempoByDay[date]) {
      const proj = (e.issueKey || '').split('-')[0] || '?';
      drafts[proj] = (drafts[proj] || 0) + (parseInt(e.timeSeconds, 10) || 0);
    }
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

  const draftItems = Object.entries(drafts).sort((a, b) => b[1] - a[1]);
  if (draftItems.length) {
    const dt = draftItems.reduce((s, [, v]) => s + v, 0);
    html += '<h4 style="margin-top:12px">Drafts (not sent)</h4>';
    html += draftItems.map(([p, v]) => `<div class="row"><span class="proj-tag">${escapeHtml(p)}</span><span>${formatDuration(v)}</span></div>`).join('');
    html += `<div class="row total-row"><strong>Total</strong><strong>${formatDuration(dt)}</strong></div>`;
  } else if (!tempoConfigured) {
    html += '<h4>Drafts</h4><div class="muted">No drafts. Click events to add.</div>';
  }

  el.innerHTML = html;
}

// ---------- rendering: day detail ----------
function renderDay() {
  const titleEl = document.getElementById('day-title');
  const countsEl = document.getElementById('day-counts');
  const content = document.getElementById('day-content');

  if (!state.selected) {
    titleEl.textContent = 'Select a day';
    countsEl.textContent = '';
    content.innerHTML = '<div class="empty">No day selected.</div>';
    return;
  }

  const day = state.selected;
  titleEl.textContent = dayLong(day);
  const ghDay = state.events.github.filter((e) => localDay(e.time) === day);
  const slDay = state.events.slack.filter((e) => localDay(e.time) === day);
  const dayWorklogs = state.worklogs.filter((w) => w.startDate === day);
  const loggedTotal = dayWorklogs.reduce((s, w) => s + (parseInt(w.timeSpentSeconds, 10) || 0), 0);

  const counts = [`${ghDay.length} GitHub`, `${slDay.length} Slack`];
  if (dayWorklogs.length) counts.push(`${formatDuration(loggedTotal)} in Tempo`);
  countsEl.textContent = counts.join(' · ');

  if (ghDay.length === 0 && slDay.length === 0 && dayWorklogs.length === 0) {
    content.innerHTML = '<div class="empty">No activity recorded for this day.</div>';
    return;
  }

  const tempoEntries = state.tempoByDay[day] || [];
  const addedSet = new Set(tempoEntries.flatMap((e) => e.sourceIds || []));

  let html = '';
  if (dayWorklogs.length) {
    html += `<div class="section-h">Logged in Tempo <span class="muted">· ${formatDuration(loggedTotal)}</span></div>`;
    html += renderWorklogs(dayWorklogs);
  }
  if (ghDay.length) {
    html += '<div class="section-h">GitHub <span class="muted">· ' + ghDay.length + '</span></div>';
    html += renderEventGroups(ghDay, 'gh', addedSet);
  }
  if (slDay.length) {
    html += '<div class="section-h">Slack <span class="muted">· ' + slDay.length + '</span></div>';
    html += renderEventGroups(slDay, 'sl', addedSet);
  }
  content.innerHTML = html;

  // Wire up clicks
  for (const node of content.querySelectorAll('.event')) {
    node.addEventListener('click', (e) => {
      const id = node.dataset.id;
      const src = node.dataset.source;
      const ev = (src === 'gh' ? ghDay : slDay).find((x) => String(x.id) === id);
      if (ev) addEventToTempo(ev);
    });
  }
}

function renderWorklogs(worklogs) {
  // Sort by startTime ascending so the timeline reads naturally.
  const sorted = worklogs.slice().sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  return sorted.map((w) => {
    const time = (w.startTime || '').slice(0, 5) || '—';
    const key = w.issueKey || `id:${w.issueId}`;
    const desc = escapeHtml(w.description || '');
    return `
      <div class="event worklog" title="Already logged in Tempo">
        <span class="time">${escapeHtml(time)}</span>
        <span class="badge tempo">${formatDuration(w.timeSpentSeconds)}</span>
        <div><div class="title">${desc || '<span class="muted">(no description)</span>'}</div></div>
        <span class="proj has">${escapeHtml(key)}</span>
      </div>
    `;
  }).join('');
}

function renderEventGroups(events, badge, addedSet) {
  // Group consecutive same-repo/channel events visually, but render each individually.
  const groups = [];
  let cur = null;
  for (const e of events) {
    if (!cur || cur.key !== e.repoOrChannel) {
      cur = { key: e.repoOrChannel, items: [] };
      groups.push(cur);
    }
    cur.items.push(e);
  }
  return groups.map((g) => {
    const inner = g.items.map((e) => renderEvent(e, badge, addedSet)).join('');
    return `<div class="repo-group"><div class="repo-label">${escapeHtml(g.key || '?')}</div>${inner}</div>`;
  }).join('');
}

function renderEvent(e, badge, addedSet) {
  const proj = projectFor(e);
  const projCls = proj ? 'proj has' : 'proj miss';
  const projTxt = proj || '?';
  const kind = KIND_LABELS[e.kind] || e.kind;
  const title = escapeHtml(e.title || '(no title)');
  const meta = [];
  if (e.branch) meta.push(`<code>${escapeHtml(e.branch)}</code>`);
  if (e.prNumber) meta.push(`#${e.prNumber}`);
  if (e.sha) meta.push(`<code>${e.sha}</code>`);
  const metaHtml = meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : '';
  const added = addedSet.has(String(e.id)) ? ' added' : '';
  const link = e.url ? ` <a href="${e.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>` : '';
  return `
    <div class="event${added}" data-id="${e.id}" data-source="${badge}" title="Click to add to Tempo log">
      <span class="time">${hhmm(e.time)}</span>
      <span class="badge ${badge}">${kind}</span>
      <div><div class="title">${title}${link}</div>${metaHtml}</div>
      <span class="${projCls}">${escapeHtml(projTxt)}</span>
    </div>
  `;
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
        <input name="issue" placeholder="ISSUE-123" value="${escapeHtml(entry.issueKey)}" />
        <input name="time" placeholder="1h 30m" value="${formatDuration(entry.timeSeconds)}" />
        <button class="remove" title="Remove">×</button>
      </div>
      <div class="tempo-row full">
        <textarea name="desc" rows="2" placeholder="Description">${escapeHtml(entry.description)}</textarea>
      </div>
    `;
    li.querySelector('input[name="issue"]').addEventListener('input', (e) => {
      entry.issueKey = e.target.value.toUpperCase().trim();
      saveTempo();
      renderWeeklySummary();
    });
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
      // Refresh real worklogs so the summary updates.
      loadWorklogs({ refresh: true }).then(renderWeeklySummary);
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
