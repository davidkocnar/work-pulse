require('dotenv').config();

const path = require('path');
const { exec } = require('child_process');
const express = require('express');

const cache       = require('./cache');
const github      = require('./github');
const slack       = require('./slack');
const tempo       = require('./tempo');
const mappings    = require('./mappings');
const google      = require('./google');
const configStore = require('./config-store');

// OAuth app credentials bundled at build time (gitignored, generated from .env before dist).
// Falls back gracefully when the file doesn't exist (dev without the file, or open-source build).
let _bundled = {};
try { _bundled = require('./app-defaults'); } catch {}

const PORT = parseInt(process.env.PORT || '3333', 10);
const GOOGLE_REDIRECT = `http://localhost:${PORT}/auth/google/callback`;
const GITHUB_REDIRECT = `http://localhost:${PORT}/auth/github/callback`;
const SLACK_REDIRECT  = `http://localhost:${PORT}/auth/slack/callback`;

function buildEnv() {
  const c = configStore.read();
  const e = process.env;
  const b = _bundled;
  return {
    githubToken:        c.GITHUB_TOKEN         || e.GITHUB_TOKEN,
    githubUsername:     c.GITHUB_USERNAME      || e.GITHUB_USERNAME,
    githubClientId:     c.GITHUB_CLIENT_ID     || e.GITHUB_CLIENT_ID     || b.GITHUB_CLIENT_ID,
    githubClientSecret: c.GITHUB_CLIENT_SECRET || e.GITHUB_CLIENT_SECRET || b.GITHUB_CLIENT_SECRET,
    slackToken:         c.SLACK_TOKEN          || e.SLACK_TOKEN,
    slackClientId:      c.SLACK_CLIENT_ID      || e.SLACK_CLIENT_ID      || b.SLACK_CLIENT_ID,
    slackClientSecret:  c.SLACK_CLIENT_SECRET  || e.SLACK_CLIENT_SECRET  || b.SLACK_CLIENT_SECRET,
    baseUrl:            c.JIRA_BASE_URL        || e.JIRA_BASE_URL,
    email:              c.JIRA_EMAIL           || e.JIRA_EMAIL,
    apiToken:           c.JIRA_API_TOKEN       || e.JIRA_API_TOKEN,
    tempoToken:         c.TEMPO_TOKEN          || e.TEMPO_TOKEN,
    googleClientId:     c.GOOGLE_CLIENT_ID     || e.GOOGLE_CLIENT_ID     || b.GOOGLE_CLIENT_ID,
    googleClientSecret: c.GOOGLE_CLIENT_SECRET || e.GOOGLE_CLIENT_SECRET || b.GOOGLE_CLIENT_SECRET,
  };
}
let env = buildEnv();

// In Electron mode redirect back via custom URL scheme so the browser hands focus to the app.
// In plain server mode redirect to the local web page as before.
function oauthReturn(query) {
  return process.env.WORKPULSE_ELECTRON === '1'
    ? `workpulse://oauth?${query}`
    : `/?${query}`;
}

// ---------- OAuth SSE (push result to open Electron renderer) ----------
const _sseClients = new Set();
let _focusCallback = null;

// Called by electron/main.js to register the window-focus hook
function setFocusCallback(fn) { _focusCallback = fn; }

function _broadcastOAuth(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of _sseClients) { try { res.write(msg); } catch { /* ignore */ } }
  if (_focusCallback) _focusCallback();
}

function _oauthSuccessPage(message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>WorkPulse</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f1117;color:#e2e8f0}
.card{text-align:center;padding:40px;border-radius:12px;background:#1a1f2e;max-width:360px}
h2{margin:0 0 8px;color:#fff}p{margin:0 0 24px;color:#94a3b8;font-size:14px}
button{background:#6366f1;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;cursor:pointer}</style>
</head><body><div class="card">
<h2>✓ ${message}</h2>
<p>You can close this tab and return to WorkPulse.</p>
<button onclick="window.close()">Close tab</button>
</div></body></html>`;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/oauth/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  _sseClients.add(res);
  req.on('close', () => _sseClients.delete(res));
});

// ---------- Health ----------
app.get('/api/health', (req, res) => {
  const gs = google.getConnectionStatus();
  res.json({
    ok: true,
    config: {
      github:          Boolean(env.githubToken && env.githubUsername),
      slack:           Boolean(env.slackToken),
      jira:            Boolean(env.baseUrl && env.email && env.apiToken),
      tempo:           Boolean(env.tempoToken && env.baseUrl && env.email && env.apiToken),
      google:          Boolean(env.googleClientId && env.googleClientSecret),
    },
    googleConnected:   gs.connected,
    githubUsername:    env.githubUsername || null,
    githubOAuth:       Boolean(env.githubClientId),
    slackOAuth:        Boolean(env.slackClientId),
    electronMode:      process.env.WORKPULSE_ELECTRON === '1',
  });
});

// ---------- Events (GitHub + Slack + Google Calendar + Gmail) ----------
app.get('/api/events', async (req, res) => {
  const now   = new Date();
  const year  = parseInt(req.query.year  || now.getFullYear(),     10);
  const month = parseInt(req.query.month || (now.getMonth() + 1),  10);
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Invalid year/month' });
  }

  const result = { year, month, github: [], slack: [], calendar: [], email: [], errors: {} };

  const [ghRes, slRes, calRes, mailRes] = await Promise.allSettled([
    github.fetchEvents({ year, month, token: env.githubToken, username: env.githubUsername, refresh }),
    slack.fetchMessages({ year, month, token: env.slackToken, refresh }),
    google.fetchCalendarEvents({ year, month, refresh }, env),
    google.fetchGmailMessages({ year, month, refresh }, env),
  ]);

  if (ghRes.status === 'fulfilled') {
    result.github = ghRes.value.events || [];
    result.githubCached = !!ghRes.value.cached;
    if (ghRes.value.skipped) result.errors.github = ghRes.value.reason;
  } else { result.errors.github = ghRes.reason?.message; }

  if (slRes.status === 'fulfilled') {
    result.slack = slRes.value.events || [];
    result.slackCached = !!slRes.value.cached;
    if (slRes.value.skipped) result.errors.slack = slRes.value.reason;
  } else { result.errors.slack = slRes.reason?.message; }

  if (calRes.status === 'fulfilled') {
    result.calendar = calRes.value.events || [];
    if (calRes.value.skipped) result.errors.calendar = calRes.value.reason;
  } else { result.errors.calendar = calRes.reason?.message; }

  if (mailRes.status === 'fulfilled') {
    result.email = mailRes.value.events || [];
    if (mailRes.value.skipped) result.errors.email = mailRes.value.reason;
  } else { result.errors.email = mailRes.reason?.message; }

  res.json(result);
});

// ---------- Mappings ----------
app.get('/api/mappings', (req, res) => res.json(mappings.read()));
app.put('/api/mappings', (req, res) => {
  try   { res.json(mappings.write(req.body || [])); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Jira ----------
app.get('/api/jira/search', async (req, res) => {
  if (!env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Jira not configured' });
  try   { res.json(await tempo.searchIssues(req.query.q || '', env)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- Tempo ----------
app.get('/api/tempo/worklogs', async (req, res) => {
  const now   = new Date();
  const year  = parseInt(req.query.year  || now.getFullYear(),    10);
  const month = parseInt(req.query.month || (now.getMonth() + 1), 10);
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  if (req.query.refresh === '1') cache.invalidate('tempo:worklogs');
  try   { res.json({ year, month, worklogs: await tempo.fetchWorklogs({ year, month }, env) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/tempo/suggestions', async (req, res) => {
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  const days  = Math.min(365, Math.max(7,  parseInt(req.query.days  || '90', 10) || 90));
  const limit = Math.min(50,  Math.max(3,  parseInt(req.query.limit || '15', 10) || 15));
  try   { res.json({ days, suggestions: await tempo.getSuggestions({ days, limit }, env) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/tempo', async (req, res) => {
  const { date, entries } = req.body || {};
  if (!date || !Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'date and entries[] required' });
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Tempo / Jira credentials not configured' });

  const results = [];
  let cursorMin = 9 * 60;
  for (const e of entries) {
    const seconds = parseInt(e.timeSeconds, 10) || 0;
    if (!e.issueKey || seconds <= 0) {
      results.push({ ok: false, issueKey: e.issueKey, error: 'invalid entry' });
      continue;
    }
    let startTime;
    if (e.startTime && /^\d{2}:\d{2}:\d{2}$/.test(e.startTime)) {
      startTime = e.startTime;
      const [h, m] = e.startTime.split(':').map(Number);
      cursorMin = Math.max(cursorMin, h * 60 + m + Math.max(15, Math.round(seconds / 60)));
    } else {
      const hh = String(Math.floor(cursorMin / 60)).padStart(2, '0');
      const mm = String(cursorMin % 60).padStart(2, '0');
      startTime = `${hh}:${mm}:00`;
      cursorMin += Math.max(15, Math.round(seconds / 60));
    }
    try {
      const wl = await tempo.createWorklog({ issueKey: e.issueKey, date, timeSeconds: seconds, description: e.description || '', startTime }, env);
      results.push({ ok: true, issueKey: e.issueKey, worklog: wl });
    } catch (err) {
      results.push({ ok: false, issueKey: e.issueKey, error: err.message });
    }
  }
  cache.invalidate('tempo:worklogs');
  res.status(results.every((r) => r.ok) ? 200 : 207).json({ results });
});

app.put('/api/tempo/worklog/:id', async (req, res) => {
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  let { issueId, issueKey, currentIssueId, startDate, startTime, timeSeconds, description } = req.body || {};
  if (!issueId && issueKey) {
    try { issueId = await tempo.resolveIssueId(issueKey, env); }
    catch (e) { return res.status(400).json({ error: `Cannot resolve issue key: ${e.message}` }); }
  }
  if (!issueId || !startDate || !startTime || !timeSeconds)
    return res.status(400).json({ error: 'issueId (or issueKey), startDate, startTime, timeSeconds required' });

  // Tempo API does not support moving a worklog to a different issue via PUT.
  // Detect the change and recreate the worklog instead.
  if (currentIssueId && issueId && Number(issueId) !== Number(currentIssueId)) {
    try {
      await tempo.deleteWorklog({ id: req.params.id }, env);
      const wl = await tempo.createWorklog({ issueKey, date: startDate, timeSeconds, description, startTime }, env);
      cache.invalidate('tempo:worklogs');
      return res.json(wl);
    } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  }

  try {
    const wl = await tempo.updateWorklog({ id: req.params.id, issueId, startDate, startTime, timeSeconds, description }, env);
    cache.invalidate('tempo:worklogs');
    res.json(wl);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.delete('/api/tempo/worklog/:id', async (req, res) => {
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken)
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  try {
    await tempo.deleteWorklog({ id: req.params.id }, env);
    cache.invalidate('tempo:worklogs');
    res.status(204).end();
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- Config ----------
app.get('/api/config', (req, res) => res.json(configStore.read()));

app.put('/api/config', (req, res) => {
  try {
    configStore.write(req.body || {});
    env = buildEnv();
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- GitHub OAuth ----------
app.get('/auth/github', (req, res) => {
  if (!env.githubClientId)
    return res.status(400).send('GITHUB_CLIENT_ID not configured — ask your admin to set it up.');
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(env.githubClientId)}&scope=read%3Auser%2Crepo&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT)}`;
  res.redirect(url);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/?github_error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect(`/?github_error=${encodeURIComponent('no code returned')}`);
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'WorkPulse' },
      body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, code, redirect_uri: GITHUB_REDIRECT }),
    });
    const td = await tokenRes.json();
    if (td.error) throw new Error(td.error_description || td.error);
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${td.access_token}`, 'User-Agent': 'WorkPulse', Accept: 'application/vnd.github+json' },
    });
    const user = await userRes.json();
    configStore.merge({ GITHUB_TOKEN: td.access_token, GITHUB_USERNAME: user.login });
    env = buildEnv();
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ github: 'connected', username: user.login });
      res.send(_oauthSuccessPage('GitHub connected'));
    } else {
      res.redirect('/?github=connected');
    }
  } catch (e) {
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ github_error: e.message });
      res.send(_oauthSuccessPage('GitHub connection failed'));
    } else {
      res.redirect(`/?github_error=${encodeURIComponent(e.message)}`);
    }
  }
});

// ---------- Slack OAuth ----------
app.get('/auth/slack', (req, res) => {
  if (!env.slackClientId)
    return res.status(400).send('SLACK_CLIENT_ID not configured — ask your admin to set it up.');
  const scopes = 'search:read,users:read,channels:read,im:read,mpim:read';
  const url = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(env.slackClientId)}&user_scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(SLACK_REDIRECT)}`;
  res.redirect(url);
});

app.get('/auth/slack/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/?slack_error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect(`/?slack_error=${encodeURIComponent('no code returned')}`);
  try {
    const params = new URLSearchParams({ client_id: env.slackClientId, client_secret: env.slackClientSecret, code, redirect_uri: SLACK_REDIRECT });
    const tokenRes = await fetch(`https://slack.com/api/oauth.v2.access?${params}`, { headers: { Accept: 'application/json' } });
    const data = await tokenRes.json();
    if (!data.ok) throw new Error(data.error || 'OAuth failed');
    const token = data.authed_user?.access_token;
    if (!token) throw new Error('No user token returned — ensure user scopes are configured in your Slack app.');
    configStore.merge({ SLACK_TOKEN: token });
    env = buildEnv();
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ slack: 'connected' });
      res.send(_oauthSuccessPage('Slack connected'));
    } else {
      res.redirect('/?slack=connected');
    }
  } catch (e) {
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ slack_error: e.message });
      res.send(_oauthSuccessPage('Slack connection failed'));
    } else {
      res.redirect(`/?slack_error=${encodeURIComponent(e.message)}`);
    }
  }
});

// ---------- Google OAuth ----------
app.get('/auth/google', (req, res) => {
  if (!env.googleClientId)
    return res.status(400).send('GOOGLE_CLIENT_ID not configured — add it in Settings first.');
  res.redirect(google.getAuthUrl(env.googleClientId, GOOGLE_REDIRECT));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/?google_error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect(`/?google_error=${encodeURIComponent('no code returned')}`);
  try {
    await google.exchangeCode(env.googleClientId, env.googleClientSecret, GOOGLE_REDIRECT, code);
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ google: 'connected' });
      res.send(_oauthSuccessPage('Google connected'));
    } else {
      res.redirect('/?google=connected');
    }
  } catch (e) {
    if (process.env.WORKPULSE_ELECTRON === '1') {
      _broadcastOAuth({ google_error: e.message });
      res.send(_oauthSuccessPage('Google connection failed'));
    } else {
      res.redirect(`/?google_error=${encodeURIComponent(e.message)}`);
    }
  }
});

app.post('/auth/google/disconnect', (req, res) => {
  google.clearTokens();
  res.json({ ok: true });
});

app.post('/auth/github/disconnect', (req, res) => {
  configStore.remove(['GITHUB_TOKEN', 'GITHUB_USERNAME']);
  env = buildEnv();
  res.json({ ok: true });
});

app.post('/auth/slack/disconnect', (req, res) => {
  configStore.remove(['SLACK_TOKEN']);
  env = buildEnv();
  res.json({ ok: true });
});

// ---------- Cache clear ----------
app.post('/api/cache/clear', (req, res) => {
  cache.invalidate('');
  res.json({ ok: true });
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'client')));

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === '0') return;
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`WorkPulse ready → ${url}`);
  console.log(`Config: github=${!!env.githubToken} slack=${!!env.slackToken} jira=${!!env.apiToken} tempo=${!!env.tempoToken} google=${!!env.googleClientId}`);
  openBrowser(url);
});

process.on('SIGINT',  () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

module.exports = { setFocusCallback };
