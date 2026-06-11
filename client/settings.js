import { state } from './state.js';
import { render, actions } from './render.js';
import { escapeHtml } from './utils.js';
import { api } from './api.js';

// ---------- Settings modal ----------
export function updateGithubStatusUI() {
  const oauthEl      = document.getElementById('settings-github-oauth');
  const manualEl     = document.getElementById('settings-github-manual');
  const statusEl     = document.getElementById('settings-github-status');
  const connectBtn   = document.getElementById('settings-github-connect');
  const disconnectBtn= document.getElementById('settings-github-disconnect');
  if (!oauthEl) return;
  const hasOauth  = state.health.githubOAuth;
  const connected = state.health.config?.github;
  oauthEl.style.display  = hasOauth ? '' : 'none';
  manualEl.style.display = hasOauth ? 'none' : '';
  if (!hasOauth) return;
  if (connected) {
    statusEl.textContent = `✓ Connected${state.health.githubUsername ? ' as ' + state.health.githubUsername : ''}`;
    statusEl.className = 'settings-google-status ok';
  } else {
    statusEl.textContent = 'Not connected — click Connect GitHub to authorize.';
    statusEl.className = 'settings-google-status warn';
  }
  connectBtn.style.display    = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? ''     : 'none';
}

export function updateSlackStatusUI() {
  const oauthEl      = document.getElementById('settings-slack-oauth');
  const manualEl     = document.getElementById('settings-slack-manual');
  const statusEl     = document.getElementById('settings-slack-status');
  const connectBtn   = document.getElementById('settings-slack-connect');
  const disconnectBtn= document.getElementById('settings-slack-disconnect');
  if (!oauthEl) return;
  const hasOauth  = state.health.slackOAuth;
  const connected = state.health.config?.slack;
  oauthEl.style.display  = hasOauth ? '' : 'none';
  manualEl.style.display = hasOauth ? 'none' : '';
  if (!hasOauth) return;
  if (connected) {
    statusEl.textContent = '✓ Connected';
    statusEl.className = 'settings-google-status ok';
  } else {
    statusEl.textContent = 'Not connected — click Connect Slack to authorize.';
    statusEl.className = 'settings-google-status warn';
  }
  connectBtn.style.display    = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? ''     : 'none';
}

export function updateGoogleStatusUI() {
  const statusEl      = document.getElementById('settings-google-status');
  const connectBtn    = document.getElementById('settings-google-connect');
  const disconnectBtn = document.getElementById('settings-google-disconnect');
  if (!statusEl) return;
  const connected = state.health.googleConnected;
  if (connected) {
    statusEl.textContent = '✓ Connected';
    statusEl.className = 'settings-google-status ok';
  } else {
    statusEl.textContent = '';
    statusEl.className = 'settings-google-status';
  }
  connectBtn.style.display    = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? ''     : 'none';
}

export async function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-feedback').textContent = '';
  const redirectEl = document.getElementById('google-redirect-uri-settings');
  if (redirectEl) redirectEl.textContent = `${window.location.origin}/auth/google/callback`;
  updateGithubStatusUI();
  updateSlackStatusUI();
  updateGoogleStatusUI();
  try {
    const cfg = await api('/api/config');
    document.getElementById('cfg-github-username').value = cfg.GITHUB_USERNAME   || '';
    document.getElementById('cfg-github-token').value    = cfg.GITHUB_TOKEN      || '';
    document.getElementById('cfg-slack-token').value     = cfg.SLACK_TOKEN       || '';
    document.getElementById('cfg-jira-url').value        = cfg.JIRA_BASE_URL     || 'https://thefuntasty.atlassian.net';
    document.getElementById('cfg-jira-email').value      = cfg.JIRA_EMAIL        || '';
    document.getElementById('cfg-jira-token').value      = cfg.JIRA_API_TOKEN    || '';
    document.getElementById('cfg-tempo-token').value     = cfg.TEMPO_TOKEN       || '';
  } catch (e) {
    actions.toast('Could not load config: ' + e.message, 'err');
  }
}

export function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

export async function saveSettings() {
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
      }),
    });
    await actions.loadHealth();
    updateGithubStatusUI();
    updateSlackStatusUI();
    updateGoogleStatusUI();
    fb.textContent = '✓ Saved';
    fb.className = 'feedback ok';
  } catch (e) {
    fb.textContent = 'Error: ' + e.message;
    fb.className = 'feedback err';
  }
}

// ---------- Mappings modal ----------
export function openMappings() {
  const modal = document.getElementById('mappings-modal');
  modal.classList.remove('hidden');
  renderMappingsTable(state.mappings.slice());
}

export function closeMappings() {
  document.getElementById('mappings-modal').classList.add('hidden');
}

export function renderMappingsTable(list) {
  const tbody = document.getElementById('mappings-tbody');
  tbody.innerHTML = '';
  const placeholders = {
    github: 'org/repo',
    slack: 'channel-name',
    'slack-dm': 'Display Name',
    calendar: 'Meeting title',
  };
  list.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select>
        <option value="github"${m.type === 'github' ? ' selected' : ''}>GitHub repo</option>
        <option value="slack"${m.type === 'slack' ? ' selected' : ''}>Slack channel</option>
        <option value="slack-dm"${m.type === 'slack-dm' ? ' selected' : ''}>Slack DM</option>
        <option value="calendar"${m.type === 'calendar' ? ' selected' : ''}>Calendar meeting</option>
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
      await actions.saveMappings(list.filter((m) => m.key && m.project));
      closeMappings();
      render.day();
      actions.toast('Mappings saved.', 'ok');
    } catch (e) {
      actions.toast(e.message, 'err');
    }
  };
}
