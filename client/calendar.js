import { state } from './state.js';
import { render, actions } from './render.js';
import { escapeHtml, monthName, pad, ymd, formatDuration } from './utils.js';

// ---------- rendering: status ----------
export function renderStatusPill() {
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
  if (c.google) parts.push(`google:${state.health.googleConnected ? '✓' : '✕'}`);
  el.textContent = parts.join(' ');
  el.className = 'pill ' + (c.github || c.slack ? 'ok' : 'warn');
}

// ---------- rendering: calendar ----------
export function renderCalendar() {
  document.getElementById('month-label').textContent = monthName(state.year, state.month);
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';
  cal.classList.toggle('cal-loading', state.loading);

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

  // Draft / logged indicators for calendar cell borders
  const draftDays = new Set(
    Object.entries(state.tempoByDay).filter(([, e]) => e.length > 0).map(([d]) => d),
  );
  const loggedTotalByDay = new Map();
  for (const w of state.worklogs) {
    if (w.startDate) loggedTotalByDay.set(w.startDate, (loggedTotalByDay.get(w.startDate) || 0) + (parseInt(w.timeSpentSeconds, 10) || 0));
  }
  const loggedDays = new Set([...loggedTotalByDay.entries()].filter(([, s]) => s >= 8 * 3600).map(([d]) => d));

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
    if (dStr === todayStr)      cell.classList.add('today');
    if (dStr === state.selected) cell.classList.add('selected');
    if (loggedDays.has(dStr))  cell.classList.add('has-logged');
    else if (draftDays.has(dStr)) cell.classList.add('has-draft');
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
    cell.addEventListener('click', () => actions.selectDay(dStr));
    grid.appendChild(cell);
  }

  cal.appendChild(grid);
  renderWeeklySummary();
}

export function renderWeeklySummary() {
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

  // Week containing the selected day (falls back to today if none selected)
  const ref = state.selected ? new Date(state.selected + 'T12:00:00') : new Date();
  const dow = ref.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const monDate = new Date(ref); monDate.setDate(ref.getDate() + monOffset);
  const weekStartStr = ymd(monDate);
  const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
  const weekEndStr = ymd(sunDate);
  const WEEKLY_TARGET = 40 * 3600;
  let weekLogged = 0;
  for (const w of state.worklogs) {
    if (w.startDate >= weekStartStr && w.startDate <= weekEndStr)
      weekLogged += parseInt(w.timeSpentSeconds, 10) || 0;
  }
  for (const [date, entries] of Object.entries(state.tempoByDay)) {
    if (date >= weekStartStr && date <= weekEndStr)
      weekLogged += entries.reduce((s, e) => s + (parseInt(e.timeSeconds, 10) || 0), 0);
  }
  const weekPct  = Math.min(100, Math.round(weekLogged / WEEKLY_TARGET * 100));
  const weekOver = weekLogged > WEEKLY_TARGET;

  let html = '';
  if (tempoConfigured) {
    const weekLabel = monDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      + ' – ' + sunDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    html += `<div class="week-progress">
      <div class="week-progress-label"><span>${escapeHtml(weekLabel)}</span><span>${formatDuration(weekLogged)} / 40h</span></div>
      <div class="week-progress-bar"><div class="week-progress-fill${weekOver ? ' over' : ''}" style="width:${weekPct}%"></div></div>
    </div>`;
    const items = Object.entries(logged).sort((a, b) => b[1] - a[1]);
    const total = items.reduce((s, [, v]) => s + v, 0);
    html += '<h4>Logged this month</h4>';
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
    row.addEventListener('click', () => actions.selectDay(row.dataset.day));
  }
}
