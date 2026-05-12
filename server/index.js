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

const PORT = parseInt(process.env.PORT || '3333', 10);
const GOOGLE_REDIRECT = `http://localhost:${PORT}/auth/google/callback`;

function buildEnv() {
  const c = configStore.read();
  return {
    githubToken:        c.GITHUB_TOKEN        || process.env.GITHUB_TOKEN,
    githubUsername:     c.GITHUB_USERNAME     || process.env.GITHUB_USERNAME,
    slackToken:         c.SLACK_TOKEN         || process.env.SLACK_TOKEN,
    baseUrl:            c.JIRA_BASE_URL       || process.env.JIRA_BASE_URL,
    email:              c.JIRA_EMAIL          || process.env.JIRA_EMAIL,
    apiToken:           c.JIRA_API_TOKEN      || process.env.JIRA_API_TOKEN,
    tempoToken:         c.TEMPO_TOKEN         || process.env.TEMPO_TOKEN,
    googleClientId:     c.GOOGLE_CLIENT_ID    || process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.GOOGLE_CLIENT_SECRET|| process.env.GOOGLE_CLIENT_SECRET,
  };
}
let env = buildEnv();

const app = express();
app.use(express.json({ limit: '1mb' }));

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
    res.redirect('/?google=connected');
  } catch (e) {
    res.redirect(`/?google_error=${encodeURIComponent(e.message)}`);
  }
});

app.post('/auth/google/disconnect', (req, res) => {
  google.clearTokens();
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
