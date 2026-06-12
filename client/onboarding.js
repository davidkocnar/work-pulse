import { state } from './state.js';
import { render, actions } from './render.js';
import { escapeHtml } from './utils.js';
import { api } from './api.js';

// ---------- Onboarding ----------
export const OB_STEPS = ['welcome', 'github', 'slack', 'google', 'jira', 'done'];
export let obStepIdx = 0;
export let _activeObSteps = [...OB_STEPS];

export function obStepDef(id) {
  const defs = {
    welcome: {
      icon: '⚡',
      title: 'Welcome to WorkPulse',
      hideProgress: true,
      html: `
        <p class="ob-desc">WorkPulse aggregates your work activity from <strong>GitHub, Slack, Google Calendar, and Gmail</strong> into a daily timeline — so you can review your day and log time to Jira via Tempo in seconds.</p>
        <div class="ob-feature-list">
          <div class="ob-feature"><span class="ob-fi">📆</span><div><strong>Daily timeline</strong><br>All events from all sources in one chronological view.</div></div>
          <div class="ob-feature"><span class="ob-fi">⏱</span><div><strong>One-click logging</strong><br>Click an event → it becomes a Tempo draft with the right time pre-filled.</div></div>
          <div class="ob-feature"><span class="ob-fi">🗺</span><div><strong>Smart mappings</strong><br>Link GitHub repos, Slack channels, and meetings to Jira project keys.</div></div>
        </div>
        <p class="ob-desc muted small">Let's connect your tools. Each step is optional — skip what you don't need.</p>`,
      canSkip: false,
      nextLabel: 'Get started →',
    },
    github: {
      icon: '🐙',
      title: 'GitHub',
      subtitle: 'Commits · Pull requests · Code reviews',
      hasGithubOauth: true,
      howto: `<ol>
        <li>Open <a href="https://github.com/settings/tokens/new?scopes=read:user,repo&description=WorkPulse" target="_blank" rel="noopener">GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)</a></li>
        <li>Set a name (e.g. <em>WorkPulse</em>)</li>
        <li>Select scopes: <code>read:user</code> and <code>repo</code></li>
        <li>Click <strong>Generate token</strong> and copy it</li>
      </ol>`,
      fields: [
        { key: 'GITHUB_USERNAME', label: 'GitHub username', type: 'text', placeholder: 'your-github-username' },
        { key: 'GITHUB_TOKEN',    label: 'Personal access token', type: 'password', placeholder: 'ghp_…' },
      ],
      canSkip: true,
    },
    slack: {
      icon: '💬',
      title: 'Slack',
      subtitle: 'Messages you sent in channels & DMs',
      hasSlackOauth: true,
      howto: `<ol>
        <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> → <strong>Create New App</strong> → From scratch</li>
        <li>Pick any name (e.g. <em>WorkPulse</em>) and select your workspace</li>
        <li>In the app settings go to <strong>OAuth & Permissions</strong> → Scopes → <strong>User Token Scopes</strong></li>
        <li>Add scope: <code>search:read</code></li>
        <li>Click <strong>Install to Workspace</strong> → copy the <em>User OAuth Token</em> (starts with <code>xoxp-</code>)</li>
      </ol>`,
      fields: [
        { key: 'SLACK_TOKEN', label: 'User OAuth Token', type: 'password', placeholder: 'xoxp-…' },
      ],
      canSkip: true,
    },
    jira: {
      icon: '📋',
      title: 'Jira & Tempo',
      subtitle: 'Issue search · Time logging',
      howto: `<strong>Jira API token</strong>
      <ol>
        <li>Open <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">id.atlassian.com → Security → API tokens</a></li>
        <li>Click <strong>Create API token</strong>, give it any label (e.g. <em>WorkPulse</em>), copy the value</li>
        <li>No scope selection needed — the token inherits your Jira account permissions</li>
      </ol>
      <strong>Tempo token</strong>
      <ol>
        <li>Open <a href="https://thefuntasty.atlassian.net/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration/api-integration" target="_blank" rel="noopener">Tempo → API Integration</a></li>
        <li>Click <strong>New Token</strong>, give it a name</li>
        <li>Enable scopes: <code>worklogs:read</code> and <code>worklogs:write</code> (or select all)</li>
        <li>Copy the token</li>
      </ol>`,
      fields: [
        { key: 'JIRA_BASE_URL',   label: 'Jira base URL',      type: 'text',     placeholder: 'https://your-org.atlassian.net', defaultValue: 'https://thefuntasty.atlassian.net' },
        { key: 'JIRA_EMAIL',      label: 'Atlassian email',    type: 'text',     placeholder: 'you@company.com' },
        { key: 'JIRA_API_TOKEN',  label: 'Jira API token',     type: 'password', placeholder: 'token from id.atlassian.com' },
        { key: 'TEMPO_TOKEN',     label: 'Tempo token',        type: 'password', placeholder: 'tempo API token' },
      ],
      canSkip: true,
    },
    google: {
      icon: '📅',
      title: 'Google Calendar & Gmail',
      subtitle: 'Meetings · Sent emails',
      canSkip: true,
      hasOauth: true,
    },
    done: {
      icon: '✅',
      title: 'You\'re all set!',
      hideProgress: false,
      html: `
        <p class="ob-desc">Here's how to use WorkPulse day-to-day:</p>
        <div class="ob-feature-list">
          <div class="ob-feature"><span class="ob-fi">1</span><div><strong>Pick a day</strong><br>Click any day in the left calendar. Dots show days with activity.</div></div>
          <div class="ob-feature"><span class="ob-fi">2</span><div><strong>Build your log</strong><br>Click events in the timeline to add them as draft entries in the right panel. Or click meetings in the Tempo column.</div></div>
          <div class="ob-feature"><span class="ob-fi">3</span><div><strong>Send to Tempo</strong><br>Fill in issue keys and times, then hit <strong>Send to Tempo</strong>. Done.</div></div>
          <div class="ob-feature"><span class="ob-fi">💡</span><div><strong>Mappings</strong><br>Open <strong>Mappings</strong> in the toolbar to link repos, channels, and meetings to Jira project keys — they'll auto-fill next time.</div></div>
        </div>`,
      canSkip: false,
      nextLabel: 'Start using WorkPulse',
      isLast: true,
    },
  };
  return defs[id] || {};
}

export function showOnboarding(startStep = 0) {
  _activeObSteps = [...OB_STEPS];
  obStepIdx = startStep;
  document.getElementById('onboarding-modal').classList.remove('hidden');
  renderObStep();
}

export function showOnboardingFiltered() {
  const cfg = state.health.config || {};
  _activeObSteps = OB_STEPS.filter((id) => {
    if (id === 'welcome' || id === 'done') return true;
    if (id === 'github') return !cfg.github;
    if (id === 'slack')  return !cfg.slack;
    if (id === 'jira')   return !cfg.jira || !cfg.tempo;
    if (id === 'google') return !state.health.googleConnected;
    return true;
  });
  // If everything is already set up, just mark done silently
  if (_activeObSteps.length <= 2) {
    localStorage.setItem('workpulse:onboarding-done', '1');
    return;
  }
  obStepIdx = 0;
  document.getElementById('onboarding-modal').classList.remove('hidden');
  renderObStep();
}

export function hideOnboarding() {
  document.getElementById('onboarding-modal').classList.add('hidden');
  const firstTime = !localStorage.getItem('workpulse:onboarding-done');
  localStorage.setItem('workpulse:onboarding-done', '1');
  if (firstTime) showTour();
}

export function renderObStep() {
  const id = _activeObSteps[obStepIdx];
  const def = obStepDef(id);
  const isFirst = obStepIdx === 0;
  const isLast  = def.isLast;

  // Progress dots — only for middle steps, hide on welcome
  const prog = document.getElementById('ob-progress');
  if (def.hideProgress) {
    prog.innerHTML = '';
  } else {
    prog.innerHTML = _activeObSteps.map((s, i) =>
      `<span class="ob-dot${i === obStepIdx ? ' ob-dot-active' : ''}"></span>`,
    ).join('');
  }

  // Body
  let bodyHtml = `<div class="ob-step-head">
    <span class="ob-icon">${def.icon}</span>
    <div>
      <div class="ob-step-title">${def.title}</div>
      ${def.subtitle ? `<div class="ob-step-sub">${def.subtitle}</div>` : ''}
    </div>
  </div>`;

  if (def.html) {
    bodyHtml += def.html;
  } else {
    // GitHub OAuth button (shown when admin has configured the OAuth App)
    if (def.hasGithubOauth && state.health.githubOAuth) {
      const connected = state.health.config?.github;
      if (connected) {
        bodyHtml += `<div class="ob-oauth-connected">✓ Connected as <strong>${escapeHtml(state.health.githubUsername || 'GitHub user')}</strong></div>`;
      } else {
        bodyHtml += `<button id="ob-github-connect" class="ob-oauth-btn">Connect GitHub →</button>
          <p class="muted small" style="margin-top:6px">Opens GitHub login. You'll return here automatically.</p>`;
      }
    } else if (def.hasGithubOauth || def.hasSlackOauth) {
      // OAuth not configured by admin — fall through to manual fields below
    }

    // Slack OAuth button
    if (def.hasSlackOauth && state.health.slackOAuth) {
      const connected = state.health.config?.slack;
      if (connected) {
        bodyHtml += `<div class="ob-oauth-connected">✓ Connected to Slack</div>`;
      } else {
        bodyHtml += `<button id="ob-slack-connect" class="ob-oauth-btn">Connect Slack →</button>
          <p class="muted small" style="margin-top:6px">Opens Slack login. You'll return here automatically.</p>`;
      }
    }

    // Show manual fields only if OAuth is not available for this step
    const githubOAuthActive = def.hasGithubOauth && state.health.githubOAuth;
    const slackOAuthActive  = def.hasSlackOauth  && state.health.slackOAuth;
    const hideManual = githubOAuthActive || slackOAuthActive;

    if (def.howto && !hideManual) {
      bodyHtml += `<details class="ob-howto"><summary>How to get the token manually</summary><div class="ob-howto-body">${def.howto}</div></details>`;
    } else if (def.howto && !def.hasGithubOauth && !def.hasSlackOauth) {
      bodyHtml += `<details class="ob-howto" open><summary>How to get the token</summary><div class="ob-howto-body">${def.howto}</div></details>`;
    }
    if (def.fields && !hideManual) {
      bodyHtml += '<div class="ob-fields">';
      for (const f of def.fields) {
        bodyHtml += `<div class="ob-field">
          <label>${escapeHtml(f.label)}</label>
          <input type="${f.type}" data-cfg-key="${f.key}" placeholder="${escapeHtml(f.placeholder)}" autocomplete="off" />
        </div>`;
      }
      bodyHtml += '</div>';
    }
    if (def.hasOauth) {
      if (state.health.googleConnected) {
        bodyHtml += `<div class="ob-oauth-connected">✓ Connected to Google Calendar &amp; Gmail</div>`;
      } else {
        bodyHtml += `<button id="ob-google-connect" class="ob-oauth-btn">Connect Google →</button>
          <p class="muted small" style="margin-top:6px">Opens Google login in your browser. You'll return here automatically.</p>`;
      }
    }
  }

  document.getElementById('ob-body').innerHTML = bodyHtml;

  // Pre-fill fields from existing config (read current input values from Settings)
  if (def.fields) {
    const settingsMap = {
      GITHUB_USERNAME:     'cfg-github-username',
      GITHUB_TOKEN:        'cfg-github-token',
      SLACK_TOKEN:         'cfg-slack-token',
      JIRA_BASE_URL:       'cfg-jira-url',
      JIRA_EMAIL:          'cfg-jira-email',
      JIRA_API_TOKEN:      'cfg-jira-token',
      TEMPO_TOKEN:         'cfg-tempo-token',
    };
    for (const f of def.fields) {
      const obInput = document.querySelector(`[data-cfg-key="${f.key}"]`);
      if (!obInput) continue;
      const settingsInput = document.getElementById(settingsMap[f.key]);
      obInput.value = settingsInput?.value || f.defaultValue || '';
    }
  }

  // Nav buttons
  document.getElementById('ob-back').style.visibility = isFirst ? 'hidden' : 'visible';
  document.getElementById('ob-next').textContent = def.nextLabel || (isLast ? 'Finish' : 'Next →');

  // Tutorial button — only on the last step
  document.getElementById('ob-tutorial')?.remove();
  if (isLast) {
    const tutBtn = document.createElement('button');
    tutBtn.id = 'ob-tutorial';
    tutBtn.textContent = '▶ Tutorial';
    tutBtn.addEventListener('click', async () => {
      document.getElementById('onboarding-modal').classList.add('hidden');
      localStorage.setItem('workpulse:onboarding-done', '1');
      localStorage.removeItem('workpulse:tour-done');
      await actions.loadHealth();
      render.statusPill();
      _tourStepIdx = 0;
      _renderTourStep();
    });
    document.getElementById('ob-next').before(tutBtn);
  }

  // Wire OAuth buttons
  if (def.hasOauth) {
    document.getElementById('ob-google-connect')?.addEventListener('click', async () => {
      await obSaveFields();
      localStorage.setItem('workpulse:onboarding-step', 'google');
      actions.oauthNavigate('/auth/google');
    });
  }
  if (def.hasGithubOauth) {
    document.getElementById('ob-github-connect')?.addEventListener('click', () => {
      localStorage.setItem('workpulse:onboarding-step', 'github');
      actions.oauthNavigate('/auth/github');
    });
  }
  if (def.hasSlackOauth) {
    document.getElementById('ob-slack-connect')?.addEventListener('click', () => {
      localStorage.setItem('workpulse:onboarding-step', 'slack');
      actions.oauthNavigate('/auth/slack');
    });
  }
}

export async function obSaveFields() {
  const inputs = document.querySelectorAll('#ob-body [data-cfg-key]');
  const body = {};
  for (const input of inputs) {
    const val = input.value.trim();
    if (val) body[input.dataset.cfgKey] = val;
  }
  if (Object.keys(body).length === 0) return;
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(body) });
    // Mirror into Settings inputs so they stay in sync
    const settingsMap = {
      GITHUB_USERNAME:     'cfg-github-username',
      GITHUB_TOKEN:        'cfg-github-token',
      SLACK_TOKEN:         'cfg-slack-token',
      JIRA_BASE_URL:       'cfg-jira-url',
      JIRA_EMAIL:          'cfg-jira-email',
      JIRA_API_TOKEN:      'cfg-jira-token',
      TEMPO_TOKEN:         'cfg-tempo-token',
      GOOGLE_CLIENT_ID:    'cfg-google-id',
      GOOGLE_CLIENT_SECRET:'cfg-google-secret',
    };
    for (const [key, val] of Object.entries(body)) {
      const settingsEl = document.getElementById(settingsMap[key]);
      if (settingsEl) settingsEl.value = val;
    }
  } catch (e) {
    actions.toast(`Save failed: ${e.message}`, 'err');
  }
}

export async function obNext() {
  await obSaveFields();
  obStepIdx++;
  if (obStepIdx >= _activeObSteps.length) {
    hideOnboarding();
    await actions.loadHealth();
    render.statusPill();
  } else {
    renderObStep();
  }
}

export function obBack() {
  if (obStepIdx > 0) { obStepIdx--; renderObStep(); }
}

// ---------- Feature tour ----------
export const TOUR_STEPS = [
  {
    selector: '.sidebar',
    title: 'Monthly overview',
    desc: 'Browse months with the arrows in the toolbar. Colored dots on each day show GitHub, Slack, and email activity at a glance. Select any day to explore it. The weekly summary at the bottom tracks your logged hours per project.',
    preferRight: true,
  },
  {
    selector: '.day-panel',
    title: 'Daily timeline',
    desc: 'All your activity for the selected day in one chronological view — GitHub commits, pull requests, Slack messages, calendar meetings, and emails.\n\nClick any event to create a draft Tempo entry with the time pre-filled. The right column on the timeline shows your already-logged Tempo worklogs and calendar meetings.',
    preferRight: true,
  },
  {
    selector: '.tempo-panel',
    title: 'Draft entries & sending',
    desc: 'Build your Tempo log here. Assign Jira issue keys, adjust durations, and add descriptions. When ready, hit Send to Tempo — all drafts are submitted at once.\n\nFavorites at the top let you instantly re-log recurring tasks to any day.',
    preferLeft: true,
  },
];

export let _tourStepIdx = 0;

export function showTour() {
  if (localStorage.getItem('workpulse:tour-done')) return;
  _tourStepIdx = 0;
  _renderTourStep();
}

export function _renderTourStep() {
  const step = TOUR_STEPS[_tourStepIdx];

  // Clear previous highlight
  document.querySelectorAll('.tour-target').forEach((el) => el.classList.remove('tour-target'));

  const target = document.querySelector(step.selector);
  if (!target) { _endTour(); return; }

  document.getElementById('tour-overlay').classList.remove('hidden');
  target.classList.add('tour-target');

  const isLast = _tourStepIdx === TOUR_STEPS.length - 1;
  const card = document.getElementById('tour-card');
  card.classList.remove('hidden');
  card.innerHTML = `
    <div class="tour-step-label">Step ${_tourStepIdx + 1} of ${TOUR_STEPS.length}</div>
    <div class="tour-title">${step.title}</div>
    <div class="tour-desc">${escapeHtml(step.desc).replace(/\n\n/g, '<br><br>')}</div>
    <div class="tour-nav">
      <button class="tour-skip-btn">Skip tour</button>
      <button class="tour-next-btn primary">${isLast ? 'Done ✓' : 'Next →'}</button>
    </div>`;

  // Position card: prefer right of target, fall back to left, then below
  const rect   = target.getBoundingClientRect();
  const cardW  = 300;
  const gap    = 24;
  let left, top;

  if (step.preferLeft && rect.left - gap - cardW >= 8) {
    left = rect.left - gap - cardW;
  } else if (rect.right + gap + cardW <= window.innerWidth - 8) {
    left = rect.right + gap;
  } else {
    left = Math.max(8, rect.left);
  }
  // Vertically center on the target, clamped to viewport
  const cardH = 240;
  top = Math.max(12, Math.min(rect.top + rect.height / 2 - cardH / 2, window.innerHeight - cardH - 12));

  card.style.left = `${left}px`;
  card.style.top  = `${top}px`;

  card.querySelector('.tour-next-btn').addEventListener('click', () => {
    _tourStepIdx++;
    if (_tourStepIdx >= TOUR_STEPS.length) _endTour(); else _renderTourStep();
  });
  card.querySelector('.tour-skip-btn').addEventListener('click', _endTour);
}

export function _endTour() {
  document.querySelectorAll('.tour-target').forEach((el) => el.classList.remove('tour-target'));
  document.getElementById('tour-overlay').classList.add('hidden');
  document.getElementById('tour-card').classList.add('hidden');
  localStorage.setItem('workpulse:tour-done', '1');
}
