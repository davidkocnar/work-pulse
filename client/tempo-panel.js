import { state } from './state.js';
import { render, actions } from './render.js';
import { projectFor, issueKeyFromMapping } from './helpers.js';
import {
  escapeHtml, cryptoId, pad, ymd, hhmm, localDay,
  extractIssueKey, buildDescription, formatDuration, parseDuration, dayLong,
} from './utils.js';
import { saveTempo, issueTitleCache, cacheIssueTitle } from './storage.js';
import { api } from './api.js';

// ---------- Issue autocomplete ----------
let _issueDropdown = null;
let _focusedDraftEntryId = null; // id of the draft entry whose input/textarea last received focus

export function getFocusedEntryId() {
  return _focusedDraftEntryId;
}

export function closeIssueDropdown() {
  _issueDropdown?.remove();
  _issueDropdown = null;
}

export function getRecentIssues(limit = 8) {
  const byKey = new Map();
  for (const w of state.worklogs) {
    if (!w.issueKey) continue;
    const cur = byKey.get(w.issueKey) || { issueKey: w.issueKey, summary: '', count: 0, lastDate: '', lastDescription: '' };
    cur.count++;
    if (w.summary && !cur.summary) cur.summary = w.summary;
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

export function showIssueDropdown(input, items, headerText) {
  closeIssueDropdown();
  if (!items.length) return;

  const dd = document.createElement('div');
  dd.className = 'issue-dropdown';
  _issueDropdown = dd;

  let html = `<div class="io-header">${escapeHtml(headerText)}</div>`;
  for (const item of items) {
    const title = item.summary || issueTitleCache.get(item.issueKey) || item.lastDescription || '';
    html += `<div class="io-item" data-key="${escapeHtml(item.issueKey)}">
      <span class="io-key">${escapeHtml(item.issueKey)}</span>
      <span class="io-title">${escapeHtml(title)}</span>
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
      const key = row.dataset.key;
      const titleText = row.querySelector('.io-title')?.textContent?.trim();
      if (titleText) cacheIssueTitle(key, titleText);
      input.value = key;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeIssueDropdown();
    });
  }
}

export function wireIssueInput(input, entry) {
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

  function updateValidation() {
    const val = entry.issueKey;
    const invalid = val.length > 0 && !/^[A-Z][A-Z0-9]*(-\d*)?$/.test(val);
    input.classList.toggle('issue-invalid', invalid);
  }

  input.addEventListener('input', (e) => {
    entry.issueKey = e.target.value.toUpperCase().trim();
    // Auto-fill description from issue title cache when field is empty and key is complete
    if (!entry.description && /^[A-Z][A-Z0-9]+-\d+$/.test(entry.issueKey)) {
      const cached = issueTitleCache.get(entry.issueKey);
      if (cached) {
        entry.description = cached;
        const ta = input.closest('li')?.querySelector('textarea[name="desc"]');
        if (ta) ta.value = cached;
      }
    }
    saveTempo(state.tempoByDay);
    render.weeklySummary();
    updateValidation();
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
        for (const r of results) if (r.summary) cacheIssueTitle(r.key, r.summary);
        if (document.activeElement === input) {
          showIssueDropdown(
            input,
            results.map((r) => ({ issueKey: r.key, summary: r.summary || '' })),
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
      const titleText = items[activeIdx].querySelector('.io-title')?.textContent?.trim();
      if (titleText) cacheIssueTitle(key, titleText);
      input.value = key;
      entry.issueKey = key;
      if (!entry.description && titleText) {
        entry.description = titleText;
        const ta = input.closest('li')?.querySelector('textarea[name="desc"]');
        if (ta) ta.value = titleText;
      }
      saveTempo(state.tempoByDay);
      render.weeklySummary();
      updateValidation();
      closeIssueDropdown();
    } else if (e.key === 'Escape') { closeIssueDropdown(); }
  });

  input.addEventListener('blur', () => setTimeout(closeIssueDropdown, 150));
}

export function entriesForDay() {
  return (state.tempoByDay[state.selected] ||= []);
}

export function nextStartTime() {
  const entries = entriesForDay();
  let maxEndMin = -1;
  for (const e of entries) {
    if (!e.startTime) continue;
    const [h, m] = e.startTime.split(':').map(Number);
    const endMin = h * 60 + m + Math.round((parseInt(e.timeSeconds, 10) || 0) / 60);
    if (endMin > maxEndMin) maxEndMin = endMin;
  }
  if (maxEndMin >= 0) {
    const clamped = Math.min(maxEndMin, 23 * 60 + 45);
    return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}:00`;
  }
  if (state.selected === ymd(new Date())) {
    const now = new Date();
    const roundedMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
    return `${pad(Math.floor(roundedMin / 60))}:${pad(roundedMin % 60)}:00`;
  }
  return '09:00:00';
}

export function addCompactGroupToTempo(rawEvents) {
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
  saveTempo(state.tempoByDay);
  render.tempo();
  render.day();
}

export function addEventToTempo(ev) {
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
      startTime: hhmm(ev.time) + ':00',
    });
  }
  saveTempo(state.tempoByDay);
  render.tempo();
  render.day();
}

export function addMeetingToTempo(item) {
  if (!state.selected) return;
  const list = entriesForDay();
  if (list.some((e) => (e.sourceIds || []).includes(item.id))) return; // already added
  const keyFromTitle = extractIssueKey(item.title);
  const issueKey = keyFromTitle || issueKeyFromMapping(item.raw);
  list.push({
    id: cryptoId(),
    issueKey,
    timeSeconds: item.duration,
    description: item.title || '',
    sourceIds: [item.id],
    startTime: item.displayTime + ':00',
  });
  saveTempo(state.tempoByDay);
  render.tempo();
  render.day();
}

export function logAllMeetings(day) {
  const meetings = (state.events.calendar || []).filter(
    (e) => localDay(e.time) === day && e.kind !== 'event-all-day' && e.kind !== 'event-declined' && (e.duration || 0) > 0,
  );
  if (!meetings.length) return;
  const list = state.tempoByDay[day] || (state.tempoByDay[day] = []);
  for (const ev of meetings) {
    if (list.some((e) => (e.sourceIds || []).includes(String(ev.id)))) continue;
    const issueKey = extractIssueKey(ev.title) || issueKeyFromMapping(ev);
    list.push({
      id: cryptoId(),
      issueKey,
      timeSeconds: ev.duration,
      description: ev.title || '',
      sourceIds: [String(ev.id)],
      startTime: hhmm(ev.time) + ':00',
    });
  }
  saveTempo(state.tempoByDay);
  render.tempo();
  render.day();
}

export function renderTempo() {
  const list = document.getElementById('tempo-list');
  const totalEl = document.getElementById('tempo-total');
  list.innerHTML = '';

  if (!state.selected) {
    totalEl.textContent = '';
    list.innerHTML = '<li class="muted small">Select a day first.</li>';
    document.getElementById('send-btn').disabled = true;
    return;
  }

  const entries = entriesForDay();
  const total = entries.reduce((s, e) => s + (parseInt(e.timeSeconds, 10) || 0), 0);
  totalEl.textContent = entries.length ? `Σ ${formatDuration(total)}` : '';
  document.getElementById('send-btn').disabled = entries.length === 0;

  if (entries.length === 0) {
    list.innerHTML = `<li class="tempo-empty-hint">
      <ol>
        <li>Click an event in the timeline, or <strong>+ Empty entry</strong></li>
        <li>Fill in the Jira issue key &amp; time</li>
        <li>Hit <strong>Send to Tempo</strong> — entries are logged for real</li>
      </ol>
    </li>`;
    render.weeklySummary();
    return;
  }

  const sorted = [...entries].sort((a, b) => {
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return a.startTime.localeCompare(b.startTime);
  });

  for (const entry of sorted) {
    const li = document.createElement('li');
    li.dataset.id = entry.id;
    const startVal = entry.startTime ? entry.startTime.slice(0, 5) : '';
    li.innerHTML = `
      <div class="tempo-row">
        <input name="start" class="tempo-start" placeholder="HH:MM" value="${escapeHtml(startVal)}" title="Start time" />
        <div class="issue-wrap"><input name="issue" placeholder="ISSUE-123" value="${escapeHtml(entry.issueKey)}" autocomplete="off" /></div>
        <input name="time" placeholder="1h 30m" value="${formatDuration(entry.timeSeconds)}" />
        <button class="remove" title="Remove">×</button>
      </div>
      <div class="tempo-row full">
        <textarea name="desc" rows="2" placeholder="Description">${escapeHtml(entry.description)}</textarea>
      </div>
    `;
    wireIssueInput(li.querySelector('input[name="issue"]'), entry);
    // Track which draft entry is active so favorites can fill it in place.
    for (const el of li.querySelectorAll('input[name="issue"], textarea[name="desc"]')) {
      el.addEventListener('focus', () => { _focusedDraftEntryId = entry.id; });
      el.addEventListener('blur',  () => { setTimeout(() => { _focusedDraftEntryId = null; }, 200); });
    }
    li.querySelector('input[name="start"]').addEventListener('change', (e) => {
      const val = e.target.value.trim();
      if (!val) {
        entry.startTime = null;
      } else {
        const m = val.match(/^(\d{1,2}):(\d{2})$/);
        const h = m ? parseInt(m[1], 10) : NaN;
        const min = m ? parseInt(m[2], 10) : NaN;
        if (!isNaN(h) && h <= 23 && !isNaN(min) && min <= 59) {
          entry.startTime = `${pad(h)}:${pad(min)}:00`;
          e.target.value = `${pad(h)}:${pad(min)}`;
        } else {
          e.target.value = startVal; // revert invalid input
        }
      }
      saveTempo(state.tempoByDay);
      render.day();
    });
    li.querySelector('input[name="time"]').addEventListener('change', (e) => {
      const sec = parseDuration(e.target.value);
      entry.timeSeconds = sec;
      e.target.value = formatDuration(sec);
      saveTempo(state.tempoByDay);
      render.tempo();
      render.day();
    });
    li.querySelector('textarea[name="desc"]').addEventListener('input', (e) => {
      entry.description = e.target.value;
      saveTempo(state.tempoByDay);
    });
    li.querySelector('.remove').addEventListener('click', () => {
      const arr = entriesForDay();
      const idx = arr.findIndex((x) => x.id === entry.id);
      if (idx >= 0) arr.splice(idx, 1);
      saveTempo(state.tempoByDay);
      render.tempo();
      render.day();
    });
    list.appendChild(li);
  }
  render.weeklySummary();
}

export function getMappingSuggestions(sentEntries) {
  const calEvents = state.events.calendar || [];
  const seen = new Set();
  const out = [];
  for (const entry of sentEntries) {
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(entry.issueKey || '')) continue;
    for (const sid of (entry.sourceIds || [])) {
      const ev = calEvents.find((e) => String(e.id) === String(sid));
      if (!ev || !ev.title) continue;
      const title = ev.title.trim();
      if (seen.has(title.toLowerCase())) continue;
      const alreadyMapped = state.mappings.some(
        (m) => m.type === 'calendar' && m.key.toLowerCase() === title.toLowerCase(),
      );
      if (alreadyMapped) continue;
      seen.add(title.toLowerCase());
      out.push({ meetingTitle: title, project: entry.issueKey });
    }
  }
  return out;
}

export function showMappingSuggestions(suggestions) {
  const container = document.getElementById('mapping-suggestion');
  if (!container) return;
  let idx = 0;
  function renderInner() {
    if (idx >= suggestions.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }
    const s = suggestions[idx];
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="map-sugg-inner">
        <div class="map-sugg-text">💡 Map <strong>${escapeHtml(s.meetingTitle)}</strong></div>
        <div class="map-sugg-value-row">
          <span class="map-sugg-arrow">→</span>
          <input class="map-sugg-input" value="${escapeHtml(s.project)}" placeholder="PROJ or PROJ-123" title="Enter a project key (e.g. FTL) or a full task key (e.g. FTL-123)" />
        </div>
        <div class="map-sugg-btns">
          <button class="map-sugg-yes primary">Add mapping</button>
          <button class="map-sugg-no">Skip</button>
        </div>
      </div>`;
    container.querySelector('.map-sugg-yes').addEventListener('click', async () => {
      const val = container.querySelector('.map-sugg-input').value.trim().toUpperCase();
      if (!val) { actions.toast('Enter a project or task key.', 'err'); return; }
      try {
        await actions.saveMappings([...state.mappings, { type: 'calendar', key: s.meetingTitle, project: val }]);
        actions.toast(`Mapping saved: "${s.meetingTitle}" → ${val}`, 'ok');
      } catch (e) { actions.toast(e.message, 'err'); }
      idx++; renderInner();
    });
    container.querySelector('.map-sugg-no').addEventListener('click', () => { idx++; renderInner(); });
  }
  renderInner();
}

export function _extractJiraMessage(errStr) {
  // Strip any residual JSON blob, keep the human-readable prefix.
  return errStr.replace(/\{[\s\S]*\}/, '').trim().replace(/:$/, '') || errStr;
}

export async function sendTempo() {
  if (!state.selected) return;
  const entries = entriesForDay();
  if (!entries.length) { actions.toast('Nothing to send.', 'err'); return; }
  if (!state.health.config.tempo) { actions.toast('Tempo / Jira not configured.', 'err'); return; }

  const invalid = entries.filter((e) => !e.issueKey || !/^[A-Z][A-Z0-9]+-\d+$/.test(e.issueKey) || !e.timeSeconds);
  if (invalid.length) { actions.toast('Some entries are missing a valid issue key or time.', 'err'); return; }

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
    // Remove successfully submitted entries from drafts regardless of partial failure.
    if (ok > 0) {
      const okKeys = new Set(res.results.filter((r) => r.ok).map((r) => r.issueKey));
      const remaining = entries.filter((e) => !okKeys.has(e.issueKey));
      state.tempoByDay[state.selected] = remaining;
      if (remaining.length === 0) delete state.tempoByDay[state.selected];
      saveTempo(state.tempoByDay);
      actions.loadWorklogs({ refresh: true }).then(() => { render.weeklySummary(); render.day(); render.calendar(); });
    }

    if (fail === 0) {
      const suggestions = getMappingSuggestions(entries);
      render.tempo();
      render.day();
      fb.textContent = `✓ ${ok} worklog(s) sent.`;
      fb.className = 'feedback ok';
      if (suggestions.length) showMappingSuggestions(suggestions);
    } else {
      const errs = res.results.filter((r) => !r.ok)
        .map((r) => `${r.issueKey}: ${_extractJiraMessage(r.error)}`).join(' · ');
      fb.textContent = `${ok} ok, ${fail} failed → ${errs}`;
      fb.className = 'feedback err';
      render.tempo();
      render.day();
    }
  } catch (e) {
    fb.textContent = `Error: ${e.message}`;
    fb.className = 'feedback err';
  }
}

export function tempoToText() {
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

export async function copyTempo() {
  const text = tempoToText();
  if (!text) { actions.toast('Nothing to copy.', 'err'); return; }
  try {
    await navigator.clipboard.writeText(text);
    actions.toast('Copied to clipboard.', 'ok');
  } catch {
    actions.toast('Clipboard blocked.', 'err');
  }
}

