import { state } from './state.js';
import { render, actions } from './render.js';
import { projectFor } from './helpers.js';
import {
  KIND_LABELS, escapeHtml, cryptoId, pad, ymd, hhmm, localDay, dayLong, timeToMinutesOfDay,
  formatDuration, ctxHtml, extractIssueKey,
} from './utils.js';
import { saveTempo } from './storage.js';
import { api } from './api.js';

// ---------- rendering: day detail ----------

export function buildDayTimeline(day) {
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
  for (const e of (state.events.calendar || []).filter((e) => localDay(e.time) === day && e.kind !== 'event-declined')) {
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

export function renderFilterChips(counts) {
  const sources = [
    ...(counts.github > 0 ? [{ key: 'github', label: 'GH' }]    : []),
    ...(counts.slack  > 0 ? [{ key: 'slack',  label: 'Slack' }]  : []),
    ...(counts.email  > 0 ? [{ key: 'email',  label: 'Mail' }]   : []),
  ];
  const chips = sources.map(({ key, label }) => {
    const n = counts[key] || 0;
    const active = timelineFilters.has(key) ? ' active' : '';
    const disabled = n === 0 ? ' disabled' : '';
    return `<button class="filter-chip ${key}${active}${disabled}" data-source="${key}">${escapeHtml(label)} <span class="chip-count">${n}</span></button>`;
  });
  return `<div class="filter-chips">${chips.join('')}</div>`;
}

export function renderTimelineRow(item, addedSet) {
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
export const PX_PER_MIN   = 1.5;
export const GRID_START   = 9 * 60;   // 09:00
export const GRID_END     = 20 * 60;  // 20:00
export const EVENT_H      = 50;       // estimated px height of a normal event row (incl. gap)
export const COMPACT_H    = 38;       // estimated px height of a compact group row
export const TEMPO_COL_W  = 220;      // px width of right tempo column (44px labels + 172px blocks)
export const BUBBLE_H     = 28;       // px per bubble slot (26px visible + 2px gap)

// ---------- Event merging ----------
export const MERGE_GAP_MIN = 30;
export const MERGEABLE_SOURCES = new Set(['github', 'slack']);

export function mergeNearbyItems(items) {
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

export function makeMergedItem(items) {
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

// Build two-lane bubble layout for the activity column.
// Items at the same time go side-by-side (lane 0 / lane 1); overflow pushes into the less-full lane.
// Returns { placements: [{item, top, lane}], totalHeight }
export function buildLaneLayout(items, startMin, pxPerMin) {
  const sorted = [...items].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const laneBottom = [0, 0];
  const placements = [];

  for (const item of sorted) {
    const min      = timeToMinutesOfDay(item.displayTime);
    const idealTop = (min - startMin) * pxPerMin;
    let lane, top;

    if (idealTop >= laneBottom[0]) {
      lane = 0; top = idealTop;
    } else if (idealTop >= laneBottom[1]) {
      lane = 1; top = idealTop;
    } else {
      lane = laneBottom[0] <= laneBottom[1] ? 0 : 1;
      top  = laneBottom[lane];
    }

    placements.push({ item, top, lane });
    laneBottom[lane] = top + BUBBLE_H;
  }

  return { placements, totalHeight: Math.max(laneBottom[0], laneBottom[1]) };
}

export function renderBubble(item, addedSet, posStyle) {
  const added = item._group
    ? item._group.some((i) => addedSet.has(i.id))
    : addedSet.has(item.id);
  const kindLabel = KIND_LABELS[item.kind] || item.kind;

  if (item._mergedId) {
    const addedCount = item._group.filter((i) => addedSet.has(i.id)).length;
    const countLabel = addedCount > 0 ? `${addedCount}/${item._group.length}` : String(item._group.length);
    return `<div class="event-bubble event-bubble-merged${added ? ' added' : ''}" data-merged-id="${escapeHtml(item._mergedId)}" data-source="${item.source}" style="${posStyle}"><span class="bub-badge ${item.source}">${escapeHtml(item._kindSummary.slice(0, 20))}</span><span class="bub-ctx-wrap bub-ctx-main">${ctxHtml(item.source, item.repoOrChannel)}</span><span class="bub-count">${escapeHtml(countLabel)}</span></div>`;
  }

  const proj     = projectFor(item.raw || item);
  const issueKey = extractIssueKey(item.title) || extractIssueKey(item.branch);
  const title    = item.title || item.repoOrChannel || '(no title)';
  const suffix   = issueKey
    ? `<span class="bub-key">${escapeHtml(issueKey)}</span>`
    : proj ? `<span class="bub-proj">${escapeHtml(proj)}</span>` : '';

  return `<div class="event-bubble${added ? ' added' : ''}" data-id="${escapeHtml(String(item.id))}" data-source="${item.source}" style="${posStyle}"><span class="bub-badge ${item.source}">${escapeHtml(kindLabel)}</span>${item.repoOrChannel ? `<span class="bub-ctx-wrap">${ctxHtml(item.source, item.repoOrChannel)}</span>` : ''}<span class="bub-title">${escapeHtml(title)}</span>${suffix}</div>`;
}

export function renderLaneActivity(placements, addedSet) {
  if (!placements.length) return '<div class="act-empty">No activity for the selected filters.</div>';
  let html = '';
  for (const { item, top, lane } of placements) {
    const posStyle = lane === 0
      ? `top:${top}px;left:0;right:calc(50% + 2px);height:${BUBBLE_H - 2}px`
      : `top:${top}px;left:calc(50% + 2px);right:0;height:${BUBBLE_H - 2}px`;
    html += renderBubble(item, addedSet, posStyle);
  }
  return html;
}

export function renderCompactGroup(items, addedSet) {
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

export function renderMergedGroupRow(item, addedSet) {
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

export function renderTimeGrid(startMin, endMin, pxPerMin = PX_PER_MIN) {
  let html = '';
  const firstH = Math.ceil(startMin / 60);
  const lastH  = Math.floor(endMin / 60);
  for (let h = firstH; h <= lastH; h++) {
    const top = (h * 60 - startMin) * pxPerMin;
    html += `<div class="tg-line" style="top:${top}px"></div>`;
  }
  return html;
}

export function renderTempoColumn(worklogs, draftEntries, calMeetings, addedSet, startMin, endMin, pxPerMin = PX_PER_MIN) {
  let html = '';
  // Hour labels
  const firstH = Math.ceil(startMin / 60);
  const lastH  = Math.floor(endMin / 60);
  for (let h = firstH; h <= lastH; h++) {
    const top = (h * 60 - startMin) * pxPerMin;
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
    const top      = (startM - startMin) * pxPerMin;
    const height   = Math.max(m.duration / 60 * pxPerMin, 20);
    const showTitle = height > 36;
    const meetingUncertain = m.kind === 'event-tentative' || m.kind === 'event-no-response';
    html += `<div class="wb-meeting${meetingUncertain ? ' wb-meeting--uncertain' : ''}" data-meeting-id="${escapeHtml(m.id)}" style="top:${top}px;height:${height}px" title="${escapeHtml(m.title)}">
      ${showTitle ? `<span class="wb-meeting-title">${escapeHtml(m.title.slice(0, 40))}</span>` : ''}
      <span class="wb-dur">${formatDuration(m.duration)}</span>
    </div>`;
  }
  // Real Tempo worklog blocks
  for (const w of [...worklogs].sort((a, b) => a.displayTime.localeCompare(b.displayTime))) {
    const startM   = timeToMinutesOfDay(w.displayTime);
    const durMin   = w.duration / 60;
    const top      = (startM - startMin) * pxPerMin;
    const height   = Math.max(durMin * pxPerMin, 28);
    const showDesc = height > 52 && w.description;
    const showDur  = height > 38;
    html += `<div class="wb-block" data-wl-id="${escapeHtml(String(w.raw?.id ?? ''))}" style="top:${top}px;height:${height}px">
      <span class="wb-key"><span class="wb-logged-check">✓</span>${escapeHtml(w.issueKey || '?')}</span>
      ${showDur ? `<span class="wb-dur">${formatDuration(w.duration)}</span>` : ''}
      ${showDesc ? `<span class="wb-desc">${escapeHtml(w.description.slice(0, 60))}</span>` : ''}
      <div class="wb-block-actions">
        <button class="wb-btn-edit" title="Edit description">✎</button>
        <button class="wb-btn-dup" title="Duplicate after">⧉</button>
        <button class="wb-btn-del" title="Delete">×</button>
      </div>
      <div class="wb-resize-handle"></div>
    </div>`;
  }
  // Draft entries that have a startTime (created by drag-to-create or from a meeting)
  for (const e of (draftEntries || []).filter((e) => e.startTime)) {
    const startM      = timeToMinutesOfDay(e.startTime);
    const top         = (startM - startMin) * pxPerMin;
    const height      = Math.max((parseInt(e.timeSeconds, 10) || 0) / 60 * pxPerMin, 28);
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

export function showWorklogEditPopup(wl, anchorEl) {
  document.getElementById('wl-edit-popup')?.remove();
  const popup = document.createElement('div');
  popup.id = 'wl-edit-popup';
  popup.className = 'wl-edit-popup';
  popup.innerHTML = `
    <div class="wl-ep-row">
      <label>Issue key</label>
      <input class="wl-ep-key" value="${escapeHtml(wl.issueKey || '')}" placeholder="ABC-123" style="text-transform:uppercase;font-family:'JetBrains Mono',monospace" />
    </div>
    <div class="wl-ep-row">
      <label>Description</label>
      <textarea class="wl-ep-desc" rows="3">${escapeHtml(wl.description || '')}</textarea>
    </div>
    <div class="wl-ep-foot">
      <button class="wl-ep-cancel">Cancel</button>
      <button class="wl-ep-save primary">Save</button>
    </div>`;

  const rect = anchorEl.getBoundingClientRect();
  const left = Math.min(rect.right + 8, window.innerWidth - 290);
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top  = `${Math.min(rect.top, window.innerHeight - 200)}px`;
  document.body.appendChild(popup);
  popup.querySelector('.wl-ep-key').focus();

  popup.querySelector('.wl-ep-cancel').addEventListener('click', () => popup.remove());

  popup.querySelector('.wl-ep-save').addEventListener('click', async () => {
    const issueKey    = popup.querySelector('.wl-ep-key').value.trim().toUpperCase();
    const description = popup.querySelector('.wl-ep-desc').value;
    const saveBtn = popup.querySelector('.wl-ep-save');
    saveBtn.disabled = true;
    try {
      const body = { startDate: wl.startDate, startTime: wl.startTime, timeSeconds: wl.timeSpentSeconds, description, currentIssueId: wl.issueId };
      if (issueKey) body.issueKey = issueKey;
      else body.issueId = wl.issueId;
      await api(`/api/tempo/worklog/${encodeURIComponent(wl.id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      popup.remove();
      await actions.loadWorklogs({ refresh: true });
      render.weeklySummary();
      render.day();
      actions.toast('Worklog updated');
    } catch (e) {
      actions.toast(`Update failed: ${e.message}`, 'err');
      saveBtn.disabled = false;
    }
  });

  // Dismiss on outside click
  const onOutside = (e) => {
    if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', onOutside, true); }
  };
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);
}

export function pixelToTime(y, startMin, pxPerMin = PX_PER_MIN) {
  return Math.round(Math.max(0, Math.min(23 * 60 + 45, startMin + y / pxPerMin)) / 15) * 15;
}

export function wireTempoColumnDrag(colEl, startMin, pxPerMin = PX_PER_MIN) {
  const hoverLine = document.createElement('div');
  hoverLine.className = 'tc-hover-line';
  colEl.appendChild(hoverLine);

  colEl.addEventListener('mousemove', (e) => {
    if (e.buttons !== 0) return;
    if (e.target.closest('.wb-block')) { hoverLine.style.display = 'none'; return; }
    const y = e.clientY - colEl.getBoundingClientRect().top;
    const t = pixelToTime(y, startMin, pxPerMin);
    hoverLine.dataset.time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    hoverLine.style.cssText = `display:block; top:${(t - startMin) * pxPerMin}px`;
  });

  colEl.addEventListener('mouseleave', () => { hoverLine.style.display = 'none'; });

  colEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.wb-block') || e.target.closest('.wb-meeting') || e.target.closest('.tb-label')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const colRect   = colEl.getBoundingClientRect();
    const rawY      = e.clientY - colRect.top;
    const startTimeMin = pixelToTime(rawY, startMin, pxPerMin);
    const anchorY   = (startTimeMin - startMin) * pxPerMin;

    hoverLine.style.display = 'none';

    const ghost = document.createElement('div');
    ghost.className = 'wb-ghost';
    ghost.style.cssText = `top:${anchorY}px; height:${Math.round(60 * pxPerMin)}px`;
    ghost.innerHTML = `<span class="wb-key">${pad(Math.floor(startTimeMin / 60))}:${pad(startTimeMin % 60)}</span><span class="wb-dur">1h</span>`;
    colEl.appendChild(ghost);

    const onMove = (ev) => {
      const curY = ev.clientY - colRect.top;
      const dy   = Math.max(curY - anchorY, 15 * pxPerMin);
      ghost.style.height = `${dy}px`;
      const durMin = Math.max(15, Math.round(dy / pxPerMin / 15) * 15);
      ghost.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
    };

    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost.remove();

      const dy = ev.clientY - colRect.top - anchorY;
      const durSeconds = dy < 10
        ? 3600
        : Math.max(15, Math.round(dy / pxPerMin / 15) * 15) * 60;

      (state.tempoByDay[state.selected] ||= []).push({
        id: cryptoId(),
        issueKey: '',
        timeSeconds: durSeconds,
        description: '',
        sourceIds: [],
        startTime: `${pad(Math.floor(startTimeMin / 60))}:${pad(startTimeMin % 60)}:00`,
      });
      saveTempo(state.tempoByDay);
      render.tempo();
      render.day();
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
        const newH   = Math.max(15 * pxPerMin, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / pxPerMin / 15) * 15);
        block.style.height = `${durMin * pxPerMin}px`;
        block.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
      };

      const onUp = async (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const newH     = Math.max(15 * pxPerMin, startHeight + ev.clientY - startY);
        const durMin   = Math.max(15, Math.round(newH / pxPerMin / 15) * 15);
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
          actions.loadWorklogs({ refresh: true }).then(() => { render.weeklySummary(); render.day(); });
        } catch (err) {
          wl.timeSpentSeconds = oldSec;
          render.day();
          actions.toast(`Tempo update failed: ${err.message}`, 'err');
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
        const t = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin, pxPerMin);
        block.style.top = `${(t - startMin) * pxPerMin}px`;
        block.querySelector('.wb-key').textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      };

      const onUp = async (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const t          = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin, pxPerMin);
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
          actions.loadWorklogs({ refresh: true }).then(() => { render.weeklySummary(); render.day(); });
        } catch (err) {
          wl.startTime = oldTime;
          render.day();
          actions.toast(`Tempo update failed: ${err.message}`, 'err');
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Edit button → popup (stopPropagation so drag doesn't fire)
    block.querySelector('.wb-btn-edit')?.addEventListener('mousedown', (e) => e.stopPropagation());
    block.querySelector('.wb-btn-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wl = state.worklogs.find((w) => String(w.id) === wlId);
      if (wl) showWorklogEditPopup(wl, block);
    });

    // Duplicate button — creates a draft entry starting right after the worklog ends
    block.querySelector('.wb-btn-dup')?.addEventListener('mousedown', (e) => e.stopPropagation());
    block.querySelector('.wb-btn-dup')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wl = state.worklogs.find((w) => String(w.id) === wlId);
      if (!wl || !state.selected) return;
      const startMinutes = timeToMinutesOfDay(wl.startTime);
      const durMinutes = Math.ceil((wl.timeSpentSeconds || 0) / 60);
      const newStartMin = Math.min(startMinutes + durMinutes, 23 * 60 + 45);
      const newStart = `${pad(Math.floor(newStartMin / 60))}:${pad(newStartMin % 60)}:00`;
      if (!state.tempoByDay[state.selected]) state.tempoByDay[state.selected] = [];
      state.tempoByDay[state.selected].push({
        id: cryptoId(),
        issueKey: wl.issueKey || '',
        timeSeconds: wl.timeSpentSeconds,
        description: wl.description || '',
        sourceIds: [],
        startTime: newStart,
      });
      saveTempo(state.tempoByDay);
      render.tempo();
      render.day();
      actions.toast(`Duplicated at ${newStart.slice(0, 5)}`);
    });

    // Delete button
    block.querySelector('.wb-btn-del')?.addEventListener('mousedown', (e) => e.stopPropagation());
    block.querySelector('.wb-btn-del')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wl = state.worklogs.find((w) => String(w.id) === wlId);
      if (!confirm(`Delete "${wl?.description || wl?.issueKey || 'worklog'}" from Tempo?`)) return;
      try {
        await api(`/api/tempo/worklog/${encodeURIComponent(wlId)}`, { method: 'DELETE' });
        await actions.loadWorklogs({ refresh: true });
        render.weeklySummary();
        render.day();
        actions.toast('Worklog deleted');
      } catch (err) {
        actions.toast(`Delete failed: ${err.message}`, 'err');
      }
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
        const newH   = Math.max(15 * pxPerMin, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / pxPerMin / 15) * 15);
        block.style.height = `${durMin * pxPerMin}px`;
        block.querySelector('.wb-dur').textContent = formatDuration(durMin * 60);
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const newH   = Math.max(15 * pxPerMin, startHeight + ev.clientY - startY);
        const durMin = Math.max(15, Math.round(newH / pxPerMin / 15) * 15);
        entry.timeSeconds = durMin * 60;
        saveTempo(state.tempoByDay);
        render.tempo();
        render.day();
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
        const t       = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin, pxPerMin);
        block.style.top = `${(t - startMin) * pxPerMin}px`;
        block.querySelector('.wb-key').textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const t = pixelToTime(Math.max(0, ev.clientY - colRect.top - offsetY), startMin, pxPerMin);
        entry.startTime = `${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`;
        saveTempo(state.tempoByDay);
        render.tempo();
        render.day();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ---------- Single-bubble hover tooltip ----------
export function showBubbleTooltip(item, anchorEl, addedSet, allEvents) {
  document.getElementById('bub-tooltip')?.remove();

  const added     = addedSet.has(item.id);
  const kindLabel = KIND_LABELS[item.kind] || item.kind;

  const metaParts = [];
  if (item.branch)   metaParts.push(`<code>${escapeHtml(item.branch)}</code>`);
  if (item.prNumber) metaParts.push(`#${item.prNumber}`);
  if (item.sha)      metaParts.push(`<code>${escapeHtml(item.sha)}</code>`);

  const popup = document.createElement('div');
  popup.id = 'bub-tooltip';
  popup.className = 'bub-tooltip';
  popup.innerHTML = `
    <div class="bub-tt-head">
      ${ctxHtml(item.source, item.repoOrChannel)}
      <span class="bub-tt-time">${escapeHtml(item.displayTime)}</span>
      <span class="badge ${item.source}">${escapeHtml(kindLabel)}</span>
    </div>
    <div class="bub-tt-body">${escapeHtml(item.title || '(no title)')}</div>
    ${metaParts.length ? `<div class="bub-tt-meta">${metaParts.join(' · ')}</div>` : ''}
    ${item.url ? `<div class="bub-tt-meta"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open ↗</a></div>` : ''}
    <div class="bub-tt-foot">${added
      ? '<span class="bub-tt-foot-added">✓ Added to Tempo</span>'
      : '<button class="primary bub-tt-foot-btn">Add to Tempo</button>'
    }</div>`;

  const rect = anchorEl.getBoundingClientRect();
  const popW = 280;
  let left = rect.right + 6;
  if (left + popW > window.innerWidth - 8) left = rect.left - popW - 6;
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top  = `${Math.min(rect.top, window.innerHeight - 240)}px`;
  document.body.appendChild(popup);

  let dismissTimer;
  const scheduleHide = () => { dismissTimer = setTimeout(() => popup.remove(), 160); };
  const cancelHide   = () => clearTimeout(dismissTimer);
  anchorEl.addEventListener('mouseleave', scheduleHide);
  popup.addEventListener('mouseenter', cancelHide);
  popup.addEventListener('mouseleave', scheduleHide);

  popup.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return;
    const ev = allEvents.find((x) => String(x.id) === String(item.id));
    if (ev) actions.addEventToTempo(ev);
    popup.remove();
  });
}

// ---------- Compact group popup ----------
export function showCompactPopup(items, anchorEl, addedSet, allEvents, hoverMode = false) {
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

  let rowHoverTimer;
  for (const row of popup.querySelectorAll('.cmpop-row')) {
    row.addEventListener('click', () => {
      const ev = allEvents.find((e) => String(e.id) === row.dataset.id);
      if (ev) actions.addEventToTempo(ev);
      popup.remove();
    });
    const rowItem = items.find((i) => String(i.id) === row.dataset.id);
    if (rowItem) {
      row.addEventListener('mouseenter', () => {
        clearTimeout(rowHoverTimer);
        rowHoverTimer = setTimeout(() => {
          document.getElementById('bub-tooltip')?.remove();
          showBubbleTooltip(rowItem, row, addedSet, allEvents);
        }, 200);
      });
      row.addEventListener('mouseleave', () => clearTimeout(rowHoverTimer));
    }
  }

  popup.querySelector('#cmpop-add-all').addEventListener('click', () => {
    const evs = items.map((i) => allEvents.find((e) => String(e.id) === i.id)).filter(Boolean);
    if (evs.length) actions.addCompactGroupToTempo(evs);
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

export function renderDaySkeleton() {
  // Skeleton bubbles in two lanes mimicking the real layout
  const bubbles = [
    { top: 20,  lane: 0, delay: 0 },
    { top: 20,  lane: 1, delay: 120 },
    { top: 62,  lane: 0, delay: 240 },
    { top: 100, lane: 1, delay: 80 },
    { top: 130, lane: 0, delay: 360 },
    { top: 130, lane: 1, delay: 200 },
    { top: 172, lane: 0, delay: 480 },
    { top: 210, lane: 1, delay: 160 },
    { top: 248, lane: 0, delay: 320 },
    { top: 280, lane: 0, delay: 560 },
    { top: 280, lane: 1, delay: 440 },
    { top: 318, lane: 1, delay: 600 },
  ];
  const wlBlocks = [
    { top: 30,  h: 55,  delay: 0 },
    { top: 130, h: 40,  delay: 220 },
    { top: 228, h: 75,  delay: 110 },
    { top: 355, h: 48,  delay: 330 },
  ];

  let bHtml = '';
  for (const b of bubbles) {
    const side = b.lane === 0
      ? 'left:0;right:calc(50% + 2px)'
      : 'left:calc(50% + 2px);right:0';
    bHtml += `<div class="sk-bubble" style="${side};top:${b.top}px;animation-delay:-${b.delay}ms"></div>`;
  }

  let wHtml = '';
  for (const w of wlBlocks) {
    wHtml += `<div class="sk-wlblock" style="top:${w.top}px;height:${w.h}px;animation-delay:-${w.delay}ms"></div>`;
  }

  let gridHtml = '';
  let hourHtml = '';
  for (let h = 9; h <= 16; h++) {
    const top = (h - 9) * 52;
    gridHtml += `<div class="sk-gridline" style="top:${top}px"></div>`;
    hourHtml += `<div class="sk-hour-lbl" style="top:${top}px">${pad(h)}:00</div>`;
  }

  return `<div class="day-skeleton">
    <div class="sk-gridlines">${gridHtml}</div>
    <div class="sk-act">${bHtml}</div>
    <div class="sk-tempo-col">${hourHtml}${wHtml}</div>
  </div>`;
}

// Module-level filter state and timer
export let timelineFilters = new Set(['github', 'slack', 'email']);
export let nowLineTimer = null;

export function renderDay() {
  clearInterval(nowLineTimer);
  nowLineTimer = null;

  const titleEl   = document.getElementById('day-title');
  const countsEl  = document.getElementById('day-counts');
  const actionsEl = document.getElementById('day-actions');
  const content   = document.getElementById('day-content');

  if (!state.selected) {
    titleEl.textContent = state.loading ? '…' : 'Select a day';
    countsEl.innerHTML  = '';
    if (actionsEl) actionsEl.innerHTML = '';
    const hoursElInit = document.getElementById('day-hours');
    if (hoursElInit) hoursElInit.innerHTML = '';
    content.innerHTML = state.loading ? renderDaySkeleton() : '<div class="empty">No day selected.</div>';
    return;
  }

  titleEl.textContent = dayLong(state.selected);

  const { items, counts } = buildDayTimeline(state.selected);
  const worklogs    = items.filter((i) => i._type === 'worklog');
  const loggedTotal = worklogs.reduce((s, w) => s + w.duration, 0);
  countsEl.innerHTML = renderFilterChips(counts);

  // "Log all meetings" button — only shown when there are pending (not-yet-drafted) meetings
  if (actionsEl) {
    const pendingMeetings = (state.events.calendar || []).filter(
      (e) => localDay(e.time) === state.selected
        && e.kind !== 'event-all-day' && e.kind !== 'event-declined' && (e.duration || 0) > 0
        && !(state.tempoByDay[state.selected] || []).some((d) => (d.sourceIds || []).includes(String(e.id))),
    );
    if (pendingMeetings.length) {
      const n = pendingMeetings.length;
      actionsEl.innerHTML = `<button class="log-meetings-btn">📅 Log ${n} meeting${n > 1 ? 's' : ''}</button>`;
      actionsEl.querySelector('.log-meetings-btn').addEventListener('click', () => logAllMeetingsLocal(state.selected));
    } else {
      actionsEl.innerHTML = '';
    }
  }

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
  const _meetingPriority = (kind) => kind === 'event' ? 3 : (kind === 'event-tentative' || kind === 'event-no-response') ? 2 : 1;
  const _rawMeetings = items.filter((i) => i._type === 'event' && i.source === 'calendar' && i.kind !== 'event-all-day' && i.kind !== 'event-declined' && i.duration > 0);
  // For same start time keep only highest-priority meeting
  const _byTime = new Map();
  for (const m of _rawMeetings) {
    const ex = _byTime.get(m.displayTime);
    if (!ex || _meetingPriority(m.kind) > _meetingPriority(ex.kind)) _byTime.set(m.displayTime, m);
  }
  const calMeetings = [..._byTime.values()];

  // Compute time range: always 60min buffer before earliest and after latest event,
  // but never narrower than the default 9:00–20:00 window.
  let earliestMin = Infinity;
  let latestMin   = 0;
  for (const item of items) {
    const min = timeToMinutesOfDay(item.displayTime);
    if (min > 0) {
      earliestMin = Math.min(earliestMin, min);
      const hasDuration = item._type === 'worklog' || (item.source === 'calendar' && item.duration > 0);
      latestMin = Math.max(latestMin, hasDuration ? min + item.duration / 60 : min + 30);
    }
  }
  if (earliestMin === Infinity) { earliestMin = GRID_START; latestMin = GRID_END; }
  // min/max ensures we never go narrower than the default window
  const startMin = Math.max(0,        Math.min(earliestMin - 60, GRID_START));
  const endMin   = Math.min(24 * 60,  Math.max(latestMin   + 60, GRID_END));

  // Build two-lane bubble layout — merge nearby same-source items first, then assign lanes
  const rawEventItems = items.filter((i) => i._type === 'event' && timelineFilters.has(i.source));
  const eventItems    = mergeNearbyItems(rawEventItems);
  const naturalH      = (endMin - startMin) * PX_PER_MIN;
  const { placements: rawPlacements, totalHeight: actH } = buildLaneLayout(eventItems, startMin, PX_PER_MIN);
  const scale         = actH > naturalH ? actH / naturalH : 1;
  const effPxPerMin   = PX_PER_MIN * scale;
  const { placements } = scale > 1
    ? buildLaneLayout(eventItems, startMin, effPxPerMin)
    : { placements: rawPlacements };
  const containerH    = (endMin - startMin) * effPxPerMin;

  const draftEntries = state.tempoByDay[state.selected] || [];

  content.innerHTML = `
    <div class="day-two-col" style="height:${containerH}px">
      <div class="day-time-grid">${renderTimeGrid(startMin, endMin, effPxPerMin)}</div>
      <div class="day-activity-col">${renderLaneActivity(placements, addedSet)}</div>
      <div class="day-tempo-col">${renderTempoColumn(worklogs, draftEntries, calMeetings, addedSet, startMin, endMin, effPxPerMin)}</div>
    </div>`;

  wireTempoColumnDrag(content.querySelector('.day-tempo-col'), startMin, effPxPerMin);

  // Now-line — only on today
  const twoCol = content.querySelector('.day-two-col');
  if (twoCol && state.selected === ymd(new Date())) {
    const placeNowLine = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      let line = twoCol.querySelector('.now-line');
      if (!line) {
        line = document.createElement('div');
        line.className = 'now-line';
        twoCol.appendChild(line);
      }
      line.style.top = `${(nowMin - startMin) * effPxPerMin}px`;
    };
    placeNowLine();
    nowLineTimer = setInterval(placeNowLine, 60_000);
  }

  // Wire individual event clicks
  const allEvents = [
    ...state.events.github.filter((e) => localDay(e.time) === state.selected),
    ...state.events.slack.filter((e) => localDay(e.time) === state.selected),
    ...(state.events.calendar || []).filter((e) => localDay(e.time) === state.selected && e.kind !== 'event-declined'),
    ...(state.events.email    || []).filter((e) => localDay(e.time) === state.selected),
  ];
  // Build a quick id→item map for hover tooltip lookups
  const singleItemMap = new Map(
    eventItems.filter((i) => !i._mergedId).map((i) => [String(i.id), i]),
  );
  let bubbleHoverTimer;
  for (const node of content.querySelectorAll('.event-bubble[data-id]')) {
    node.addEventListener('click', () => {
      const ev = allEvents.find((x) => String(x.id) === node.dataset.id);
      if (ev) actions.addEventToTempo(ev);
    });
    const item = singleItemMap.get(node.dataset.id);
    if (item) {
      node.addEventListener('mouseenter', () => {
        clearTimeout(bubbleHoverTimer);
        bubbleHoverTimer = setTimeout(() => {
          document.getElementById('bub-tooltip')?.remove();
          showBubbleTooltip(item, node, addedSet, allEvents);
        }, 250);
      });
      node.addEventListener('mouseleave', () => clearTimeout(bubbleHoverTimer));
    }
  }

  // Wire meeting block clicks → log matching duration + start time
  for (const block of content.querySelectorAll('.wb-meeting[data-meeting-id]')) {
    block.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = calMeetings.find((m) => m.id === block.dataset.meetingId);
      if (item) actions.addMeetingToTempo(item);
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
      }, 250);
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

// logAllMeetingsLocal is needed for the "Log all meetings" button in renderDay.
// It's a local copy of the logic (same as tempo-panel's logAllMeetings but without circular import).
function logAllMeetingsLocal(day) {
  const meetings = (state.events.calendar || []).filter(
    (e) => localDay(e.time) === day && e.kind !== 'event-all-day' && e.kind !== 'event-declined' && (e.duration || 0) > 0,
  );
  if (!meetings.length) return;
  const list = state.tempoByDay[day] || (state.tempoByDay[day] = []);
  for (const ev of meetings) {
    if (list.some((e) => (e.sourceIds || []).includes(String(ev.id)))) continue;
    const issueKey = extractIssueKey(ev.title);
    list.push({
      id: cryptoId(),
      issueKey: issueKey || '',
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
