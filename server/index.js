require('dotenv').config();

const path = require('path');
const { exec } = require('child_process');
const express = require('express');

const cache = require('./cache');
const github = require('./github');
const slack = require('./slack');
const tempo = require('./tempo');
const mappings = require('./mappings');

const PORT = parseInt(process.env.PORT || '3333', 10);

const env = {
  githubToken: process.env.GITHUB_TOKEN,
  githubUsername: process.env.GITHUB_USERNAME,
  slackToken: process.env.SLACK_TOKEN,
  baseUrl: process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
  tempoToken: process.env.TEMPO_TOKEN,
};

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    config: {
      github: Boolean(env.githubToken && env.githubUsername),
      slack: Boolean(env.slackToken),
      jira: Boolean(env.baseUrl && env.email && env.apiToken),
      tempo: Boolean(env.tempoToken && env.baseUrl && env.email && env.apiToken),
    },
    githubUsername: env.githubUsername || null,
  });
});

app.get('/api/events', async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year || now.getFullYear(), 10);
  const month = parseInt(req.query.month || (now.getMonth() + 1), 10);
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Invalid year/month' });
  }

  const result = { year, month, github: [], slack: [], errors: {} };

  const [ghRes, slRes] = await Promise.allSettled([
    github.fetchEvents({ year, month, token: env.githubToken, username: env.githubUsername, refresh }),
    slack.fetchMessages({ year, month, token: env.slackToken, refresh }),
  ]);

  if (ghRes.status === 'fulfilled') {
    result.github = ghRes.value.events || [];
    result.githubCached = !!ghRes.value.cached;
    if (ghRes.value.skipped) result.errors.github = ghRes.value.reason;
  } else {
    result.errors.github = ghRes.reason && ghRes.reason.message;
  }

  if (slRes.status === 'fulfilled') {
    result.slack = slRes.value.events || [];
    result.slackCached = !!slRes.value.cached;
    if (slRes.value.skipped) result.errors.slack = slRes.value.reason;
  } else {
    result.errors.slack = slRes.reason && slRes.reason.message;
  }

  res.json(result);
});

app.get('/api/mappings', (req, res) => {
  res.json(mappings.read());
});

app.put('/api/mappings', (req, res) => {
  try {
    const list = mappings.write(req.body || []);
    res.json(list);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/jira/search', async (req, res) => {
  if (!env.baseUrl || !env.email || !env.apiToken) {
    return res.status(400).json({ error: 'Jira not configured' });
  }
  try {
    const issues = await tempo.searchIssues(req.query.q || '', env);
    res.json(issues);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/tempo/worklogs', async (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year || now.getFullYear(), 10);
  const month = parseInt(req.query.month || (now.getMonth() + 1), 10);
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken) {
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  }
  if (req.query.refresh === '1') cache.invalidate('tempo:worklogs');
  try {
    const list = await tempo.fetchWorklogs({ year, month }, env);
    res.json({ year, month, worklogs: list });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/tempo/suggestions', async (req, res) => {
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken) {
    return res.status(400).json({ error: 'Tempo / Jira not configured' });
  }
  const days = Math.min(365, Math.max(7, parseInt(req.query.days || '90', 10) || 90));
  const limit = Math.min(50, Math.max(3, parseInt(req.query.limit || '15', 10) || 15));
  try {
    const suggestions = await tempo.getSuggestions({ days, limit }, env);
    res.json({ days, suggestions });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/tempo', async (req, res) => {
  const { date, entries } = req.body || {};
  if (!date || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'date and entries[] required' });
  }
  if (!env.tempoToken || !env.baseUrl || !env.email || !env.apiToken) {
    return res.status(400).json({ error: 'Tempo / Jira credentials not configured' });
  }

  const results = [];
  // Stagger startTimes so worklogs don't overlap on the same minute
  let cursorMin = 9 * 60;
  for (const e of entries) {
    const seconds = parseInt(e.timeSeconds, 10) || 0;
    if (!e.issueKey || seconds <= 0) {
      results.push({ ok: false, issueKey: e.issueKey, error: 'invalid entry' });
      continue;
    }
    const hh = String(Math.floor(cursorMin / 60)).padStart(2, '0');
    const mm = String(cursorMin % 60).padStart(2, '0');
    try {
      const wl = await tempo.createWorklog({
        issueKey: e.issueKey,
        date,
        timeSeconds: seconds,
        description: e.description || '',
        startTime: `${hh}:${mm}:00`,
      }, env);
      results.push({ ok: true, issueKey: e.issueKey, worklog: wl });
    } catch (err) {
      results.push({ ok: false, issueKey: e.issueKey, error: err.message });
    }
    cursorMin += Math.max(15, Math.round(seconds / 60));
  }
  const allOk = results.every((r) => r.ok);
  // Invalidate worklog cache so the summary reflects the new entries on next fetch.
  cache.invalidate('tempo:worklogs');
  res.status(allOk ? 200 : 207).json({ results });
});

app.post('/api/cache/clear', (req, res) => {
  cache.invalidate('');
  res.json({ ok: true });
});

// Static frontend
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
  console.log(`Config: github=${!!env.githubToken} slack=${!!env.slackToken} jira=${!!env.apiToken} tempo=${!!env.tempoToken}`);
  openBrowser(url);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
