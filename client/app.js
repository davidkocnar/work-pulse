// WorkPulse — frontend entry point.
// Pure utilities live in utils.js. Demo dataset lives in demo.js.

import {
  ymd, cryptoId,
} from './utils.js';
import { getDemoData } from './demo.js';

import { state } from './state.js';
import { render, actions } from './render.js';
import { api } from './api.js';
import { loadTempo, saveTempo } from './storage.js';
import { rebuildDayIndex } from './helpers.js';

import { renderStatusPill, renderCalendar, renderWeeklySummary } from './calendar.js';
import { renderDay } from './timeline.js';
import {
  renderTempo, addEventToTempo, addMeetingToTempo, addCompactGroupToTempo,
  entriesForDay, nextStartTime, sendTempo,
} from './tempo-panel.js';
import { renderFavorites, openFavorites, closeFavorites } from './favorites.js';
import {
  openSettings, closeSettings, saveSettings, openMappings, closeMappings,
  updateGithubStatusUI, updateSlackStatusUI, updateGoogleStatusUI,
} from './settings.js';
import {
  OB_STEPS, showOnboarding, showOnboardingFiltered,
  obNext, obBack, showTour,
} from './onboarding.js';

// ---------- data loading ----------
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
  renderCalendar();
  if (!state.selected) renderDay();
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
    const cfg = state.health.config || {};
    const errMsgs = [];
    if (data.errors?.github   && cfg.github)  errMsgs.push(`GitHub: ${data.errors.github}`);
    if (data.errors?.slack    && cfg.slack)   errMsgs.push(`Slack: ${data.errors.slack}`);
    if (data.errors?.calendar && cfg.google)  errMsgs.push(`Calendar: ${data.errors.calendar}`);
    if (data.errors?.email    && cfg.google)  errMsgs.push(`Gmail: ${data.errors.email}`);
    if (errMsgs.length) toast(errMsgs.join(' · '), 'err');
  } finally {
    state.loading = false;
    renderStatusPill();
  }
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

function updateTodayBtn() {
  const btn = document.getElementById('today-btn');
  if (btn) btn.disabled = state.selected === ymd(new Date());
}

function selectDay(dStr) {
  state.selected = dStr;
  renderCalendar();
  renderDay();
  renderTempo();
  updateTodayBtn();
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
  updateTodayBtn();
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

// In Electron mode keep the main window stable while OAuth flows in the system browser.
// window.open triggers setWindowOpenHandler → shell.openExternal, so the local auth route
// (which redirects to GitHub/Slack/Google) opens in the user's default browser instead.
function _oauthNavigate(path) {
  if (state.health?.electronMode) {
    window.open(path, '_blank');
  } else {
    window.location.href = path;
  }
}

// ---------- Boot ----------
async function boot() {
  // Wire render/action callbacks before any user interaction
  render.day = renderDay;
  render.tempo = renderTempo;
  render.calendar = renderCalendar;
  render.weeklySummary = renderWeeklySummary;
  render.statusPill = renderStatusPill;
  render.favorites = renderFavorites;
  actions.selectDay = selectDay;
  actions.toast = toast;
  actions.addEventToTempo = addEventToTempo;
  actions.addMeetingToTempo = addMeetingToTempo;
  actions.addCompactGroupToTempo = addCompactGroupToTempo;
  actions.loadWorklogs = loadWorklogs;
  actions.loadHealth = loadHealth;
  actions.oauthNavigate = _oauthNavigate;
  actions.saveMappings = saveMappings;

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
  document.getElementById('settings-github-connect').addEventListener('click', () => {
    _oauthNavigate('/auth/github');
  });
  document.getElementById('settings-github-disconnect').addEventListener('click', async () => {
    await api('/auth/github/disconnect', { method: 'POST' });
    await loadHealth();
    updateGithubStatusUI();
    toast('GitHub disconnected.', 'ok');
  });
  document.getElementById('settings-slack-connect').addEventListener('click', () => {
    _oauthNavigate('/auth/slack');
  });
  document.getElementById('settings-slack-disconnect').addEventListener('click', async () => {
    await api('/auth/slack/disconnect', { method: 'POST' });
    await loadHealth();
    updateSlackStatusUI();
    toast('Slack disconnected.', 'ok');
  });
  document.getElementById('settings-google-connect').addEventListener('click', async () => {
    await saveSettings();
    _oauthNavigate('/auth/google');
  });
  document.getElementById('settings-google-disconnect').addEventListener('click', async () => {
    await api('/auth/google/disconnect', { method: 'POST' });
    await loadHealth();
    updateGoogleStatusUI();
    toast('Google disconnected.', 'ok');
  });
  document.getElementById('onboarding-btn').addEventListener('click', () => {
    localStorage.removeItem('workpulse:tour-done');
    showTour();
  });
  document.getElementById('settings-jira-test').addEventListener('click', async () => {
    const resultEl = document.getElementById('settings-jira-test-result');
    resultEl.textContent = 'Testing…';
    resultEl.className = 'settings-jira-test-result';
    const body = {
      baseUrl:    document.getElementById('cfg-jira-url').value.trim(),
      email:      document.getElementById('cfg-jira-email').value.trim(),
      apiToken:   document.getElementById('cfg-jira-token').value.trim(),
      tempoToken: document.getElementById('cfg-tempo-token').value.trim(),
    };
    try {
      const data = await api('/api/jira/test', { method: 'POST', body: JSON.stringify(body) });
      const parts = [];
      if (data.jira)  parts.push(data.jira.ok  ? `✓ Jira (${data.jira.displayName})` : `✗ Jira: ${data.jira.error}`);
      if (data.tempo) parts.push(data.tempo.ok ? '✓ Tempo' : `✗ Tempo: ${data.tempo.error}`);
      const allOk = [data.jira, data.tempo].filter(Boolean).every(r => r.ok);
      resultEl.textContent = parts.join('  ');
      resultEl.className = 'settings-jira-test-result ' + (allOk ? 'ok' : 'err');
    } catch (e) {
      resultEl.textContent = '✗ ' + e.message;
      resultEl.className = 'settings-jira-test-result err';
    }
  });
  document.getElementById('settings-onboarding-btn').addEventListener('click', () => { closeSettings(); showOnboarding(0); });
  document.getElementById('ob-back').addEventListener('click', obBack);
  document.getElementById('ob-next').addEventListener('click', obNext);
  document.getElementById('mappings-btn').addEventListener('click', openMappings);
  document.getElementById('mappings-close').addEventListener('click', closeMappings);
  document.getElementById('favorites-btn').addEventListener('click', openFavorites);
  document.getElementById('favorites-close').addEventListener('click', closeFavorites);
  document.getElementById('send-btn').addEventListener('click', sendTempo);
  document.getElementById('add-entry').addEventListener('click', () => {
    if (!state.selected) { toast('Select a day first.', 'err'); return; }
    entriesForDay().push({
      id: cryptoId(),
      issueKey: '',
      timeSeconds: 30 * 60,
      description: '',
      sourceIds: [],
      startTime: nextStartTime(),
    });
    saveTempo(state.tempoByDay);
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
  const _obStep = localStorage.getItem('workpulse:onboarding-step');
  const _resumeOnboarding = (toastMsg) => {
    history.replaceState(null, '', window.location.pathname);
    if (_obStep) {
      localStorage.removeItem('workpulse:onboarding-step');
      // Mutate the exported _activeObSteps reference via the module
      showOnboarding(OB_STEPS.indexOf('done'));
    } else {
      toast(toastMsg, 'ok');
    }
  };

  if (_sp.has('google')) {
    _resumeOnboarding('Google connected.');
  } else if (_sp.has('google_error')) {
    toast('Google connection failed: ' + _sp.get('google_error'), 'err');
    history.replaceState(null, '', window.location.pathname);
  } else if (_sp.has('github')) {
    await loadHealth(); renderStatusPill();
    _resumeOnboarding(`GitHub connected as ${state.health.githubUsername || 'user'}.`);
  } else if (_sp.has('github_error')) {
    toast('GitHub connection failed: ' + _sp.get('github_error'), 'err');
    history.replaceState(null, '', window.location.pathname);
  } else if (_sp.has('slack')) {
    await loadHealth(); renderStatusPill();
    _resumeOnboarding('Slack connected.');
  } else if (_sp.has('slack_error')) {
    toast('Slack connection failed: ' + _sp.get('slack_error'), 'err');
    history.replaceState(null, '', window.location.pathname);
  }

  // SSE: receive OAuth results pushed from server (used in Electron mode to avoid URL-scheme dialogs)
  const _oauthSse = new EventSource('/api/oauth/events');
  _oauthSse.onmessage = async (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    await loadHealth();
    updateGithubStatusUI();
    updateSlackStatusUI();
    updateGoogleStatusUI();
    renderStatusPill();
    // Read localStorage fresh — in Electron mode the page never navigates so _obStep (captured at
    // boot) would always be null even when the user started OAuth from inside the onboarding flow.
    function _sseResume(msg) {
      const step = localStorage.getItem('workpulse:onboarding-step');
      if (step) {
        localStorage.removeItem('workpulse:onboarding-step');
        showOnboarding(OB_STEPS.indexOf('done'));
      } else {
        toast(msg, 'ok');
      }
    }
    if (data.github === 'connected') {
      _sseResume(`GitHub connected as ${state.health.githubUsername || 'user'}.`);
      loadEvents({ refresh: true }).then(() => { renderCalendar(); renderDay(); });
    } else if (data.slack === 'connected') {
      _sseResume('Slack connected.');
      loadEvents({ refresh: true }).then(() => { renderCalendar(); renderDay(); });
    } else if (data.google === 'connected')  _sseResume('Google connected.');
    else if (data.github_error)  toast('GitHub connection failed: ' + data.github_error, 'err');
    else if (data.slack_error)   toast('Slack connection failed: '  + data.slack_error,  'err');
    else if (data.google_error)  toast('Google connection failed: ' + data.google_error, 'err');
  };

  if (_sp.has('demo')) {
    Object.assign(state, getDemoData(loadTempo));
    rebuildDayIndex();
    renderCalendar();
    renderDay();
    renderTempo();
    renderFavorites();
    renderStatusPill();
    return;
  }

  renderCalendar();
  renderDay();
  renderTempo();
  renderFavorites();

  try {
    await Promise.all([loadHealth(), loadMappings()]);
  } catch (e) {
    toast('Boot failed: ' + e.message, 'err');
    return;
  }

  if (state.health.electronMode) {
    document.body.classList.add('electron');
    if (window.electronBridge) {
      window.electronBridge.onFullscreenChange((fs) =>
        document.body.classList.toggle('electron-fullscreen', fs));
      window.electronBridge.isFullscreen().then((fs) =>
        document.body.classList.toggle('electron-fullscreen', fs));
    }
  }

  const _cfg = state.health.config || {};
  const _anythingConfigured = _cfg.github || _cfg.slack || _cfg.jira || state.health.googleConnected;
  const _oauthReturn = _sp.has('google') || _sp.has('github') || _sp.has('slack');

  if (!_anythingConfigured && !_oauthReturn) {
    // Nothing configured at all — show onboarding, skip data loading.
    showOnboardingFiltered();
    return;
  }

  if (!localStorage.getItem('workpulse:onboarding-done') && !_oauthReturn) {
    showOnboardingFiltered();
  }

  await Promise.allSettled([loadEvents({ refresh: _oauthReturn }), loadWorklogs()]);
  renderCalendar();
  pickInitialDay();
}

boot();
