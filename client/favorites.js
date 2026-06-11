import { state } from './state.js';
import { render, actions } from './render.js';
import { escapeHtml, cryptoId, formatDuration, parseDuration, dayLong } from './utils.js';
import { saveFavorites, saveTempo } from './storage.js';
import { api } from './api.js';
import { entriesForDay, nextStartTime, getFocusedEntryId } from './tempo-panel.js';

// ---------- Favorites ----------
export function renderFavorites() {
  const bar = document.getElementById('favorites-bar');
  if (!bar) return;
  if (!state.favorites.length) {
    bar.innerHTML = '<span class="muted small">No favorites yet — click Edit to add some.</span>';
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

export function addFavoriteToDay(fav) {
  if (!state.selected) { actions.toast('Select a day first.', 'err'); return; }
  if (!fav.issueKey) { actions.toast('Favorite has no issue key.', 'err'); return; }

  // If an issue input or description of a draft entry was last focused, update that entry in place.
  const focusedId = getFocusedEntryId();
  if (focusedId) {
    const list = entriesForDay();
    const entry = list.find((e) => e.id === focusedId);
    if (entry) {
      entry.issueKey = fav.issueKey;
      if (fav.timeSeconds) entry.timeSeconds = parseInt(fav.timeSeconds, 10) || entry.timeSeconds;
      if (fav.description) entry.description = fav.description;
      saveTempo(state.tempoByDay);
      render.tempo();
      render.weeklySummary();
      actions.toast(`Updated entry to ${fav.issueKey}.`, 'ok');
      return;
    }
  }

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
      startTime: nextStartTime(),
    });
  }
  saveTempo(state.tempoByDay);
  render.tempo();
  render.weeklySummary();
  actions.toast(`Added ${fav.issueKey} to ${dayLong(state.selected)}.`, 'ok');
}

export function openFavorites() {
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

export function closeFavorites() {
  document.getElementById('favorites-modal').classList.add('hidden');
}

export async function loadSuggestions() {
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

export function renderSuggestions(suggestions, days) {
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
    if (added === 0) { actions.toast('No new suggestions selected.', 'err'); return; }
    renderFavoritesTable(draft);
    sugg.classList.add('hidden');
    sugg.innerHTML = '';
    actions.toast(`Added ${added} suggestion(s) — review & save.`, 'ok');
  };
}

export function renderFavoritesTable(list) {
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
    saveFavorites(state.favorites);
    render.favorites();
    closeFavorites();
    actions.toast('Favorites saved.', 'ok');
  };
}
