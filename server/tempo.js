const cache = require('./cache');

const ISSUE_TTL_MS = 60 * 60 * 1000;
const SELF_TTL_MS = 24 * 60 * 60 * 1000;

function jiraAuthHeader(email, apiToken) {
  return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
}

async function jiraGet(pathname, { baseUrl, email, apiToken }) {
  const url = `${baseUrl.replace(/\/$/, '')}${pathname}`;
  const res = await fetch(url, {
    headers: {
      Authorization: jiraAuthHeader(email, apiToken),
      Accept: 'application/json',
      'User-Agent': 'WorkPulse',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Jira ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function getMyAccountId(env) {
  // No TTL on persistent value — accountId never changes.
  const cached = cache.get('jira:myself');
  if (cached) return cached;
  const me = await jiraGet('/rest/api/3/myself', env);
  cache.persist('jira:myself', me.accountId);
  return me.accountId;
}

async function resolveIssueId(issueKey, env) {
  const k = issueKey.toUpperCase();
  // Persistent — issue id ↔ key mapping never changes.
  const cached = cache.get(`jira:issue:${k}`);
  if (cached) return cached;
  const issue = await jiraGet(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary`, env);
  const id = parseInt(issue.id, 10);
  cache.persist(`jira:issue:${k}`, id);
  cache.persist(`jira:issueByid:${id}`, k);
  return id;
}

async function resolveIssueKeysBulk(ids, env) {
  const out = {};
  const need = [];
  for (const id of ids) {
    const cached = cache.get(`jira:issueByid:${id}`);
    if (cached) out[id] = cached;
    else need.push(id);
  }
  if (need.length === 0) return out;

  const CHUNK = 50;
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    const jql = `id in (${chunk.join(',')})`;
    const data = await jiraGet(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=${CHUNK}`,
      env,
    );
    for (const issue of (data.issues || [])) {
      const id = parseInt(issue.id, 10);
      out[id] = issue.key;
      cache.persist(`jira:issueByid:${id}`, issue.key);
      cache.persist(`jira:issue:${issue.key}`, id);
    }
  }
  return out;
}

async function searchIssues(query, env) {
  if (!query || query.length < 2) return [];
  const safe = query.replace(/"/g, '');
  const jql = `text ~ "${safe}" OR key = "${safe.toUpperCase()}" ORDER BY updated DESC`;
  const data = await jiraGet(
    `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=10`,
    env,
  );
  return (data.issues || []).map((i) => ({
    key: i.key,
    summary: (i.fields && i.fields.summary) || '',
    status: i.fields && i.fields.status && i.fields.status.name,
  }));
}

async function createWorklog({ issueKey, date, timeSeconds, description, startTime }, env) {
  const { tempoToken } = env;
  if (!tempoToken) throw new Error('TEMPO_TOKEN not configured');

  const [issueId, authorAccountId] = await Promise.all([
    resolveIssueId(issueKey, env),
    getMyAccountId(env),
  ]);

  const body = {
    issueId,
    timeSpentSeconds: Math.max(60, Math.round(timeSeconds)),
    startDate: date,
    startTime: startTime || '09:00:00',
    description: description || '',
    authorAccountId,
  };

  const res = await fetch('https://api.tempo.io/4/worklogs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tempoToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tempo ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function pad(n) { return String(n).padStart(2, '0'); }

async function fetchWorklogsRange({ from, to }, env) {
  if (!env.tempoToken) throw new Error('TEMPO_TOKEN not configured');
  const accountId = await getMyAccountId(env);

  const cacheKey = `tempo:worklogs:${accountId}:${from}:${to}`;
  const cached = cache.get(cacheKey, 60 * 1000);
  if (cached) return cached;

  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://api.tempo.io/4/worklogs/user/${encodeURIComponent(accountId)}?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.tempoToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tempo ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const results = data.results || [];
    all.push(...results);
    if (results.length < limit) break;
    offset += results.length;
    if (offset > 10000) break; // safety
  }

  // Resolve issue ids → keys in bulk. If Jira is unreachable, fall back to
  // whatever's already in the persistent cache.
  const ids = Array.from(new Set(all.map((w) => w.issue && w.issue.id).filter(Boolean)));
  let keys = {};
  try {
    keys = await resolveIssueKeysBulk(ids, env);
  } catch {
    for (const id of ids) {
      const cached = cache.get(`jira:issueByid:${id}`);
      if (cached) keys[id] = cached;
    }
  }

  const flat = all.map((w) => ({
    id: w.tempoWorklogId || w.id,
    issueId: w.issue && w.issue.id,
    issueKey: keys[w.issue && w.issue.id] || null,
    timeSpentSeconds: w.timeSpentSeconds,
    startDate: w.startDate,
    startTime: w.startTime,
    description: w.description || '',
  }));

  cache.set(cacheKey, flat);
  return flat;
}

function fetchWorklogs({ year, month }, env) {
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;
  return fetchWorklogsRange({ from, to }, env);
}

async function getSuggestions({ days = 90, limit = 15 }, env) {
  const today = new Date();
  const fromDate = new Date(today.getTime() - days * 24 * 3600 * 1000);
  const to = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
  const from = `${fromDate.getUTCFullYear()}-${pad(fromDate.getUTCMonth() + 1)}-${pad(fromDate.getUTCDate())}`;

  const worklogs = await fetchWorklogsRange({ from, to }, env);

  const byKey = new Map();
  for (const w of worklogs) {
    if (!w.issueKey) continue;
    const cur = byKey.get(w.issueKey) || {
      issueKey: w.issueKey,
      count: 0,
      totalSeconds: 0,
      lastDate: '',
      lastDescription: '',
      descriptions: new Map(),
    };
    cur.count += 1;
    cur.totalSeconds += parseInt(w.timeSpentSeconds, 10) || 0;
    if (w.startDate > cur.lastDate) {
      cur.lastDate = w.startDate;
      cur.lastDescription = w.description || '';
    }
    if (w.description) {
      cur.descriptions.set(w.description, (cur.descriptions.get(w.description) || 0) + 1);
    }
    byKey.set(w.issueKey, cur);
  }

  const list = Array.from(byKey.values()).map((s) => {
    let topDesc = '';
    let topN = 0;
    for (const [d, n] of s.descriptions) {
      if (n > topN) { topN = n; topDesc = d; }
    }
    const avg = s.count > 0 ? Math.round(s.totalSeconds / s.count) : 0;
    return {
      issueKey: s.issueKey,
      count: s.count,
      totalSeconds: s.totalSeconds,
      avgSeconds: avg,
      lastDate: s.lastDate,
      topDescription: topDesc || s.lastDescription || '',
    };
  });

  // Rank: prefer many entries + recent activity. Score = count * recency factor.
  const todayMs = today.getTime();
  for (const s of list) {
    const ageDays = s.lastDate
      ? Math.max(0, Math.floor((todayMs - new Date(`${s.lastDate}T00:00:00Z`).getTime()) / (24 * 3600 * 1000)))
      : days;
    const recency = Math.max(0.2, 1 - ageDays / days);
    s.score = s.count * recency;
  }
  list.sort((a, b) => b.score - a.score || b.count - a.count);
  return list.slice(0, limit);
}

async function updateWorklog({ id, issueId, startDate, startTime, timeSeconds, description }, env) {
  const { tempoToken } = env;
  if (!tempoToken) throw new Error('TEMPO_TOKEN not configured');
  const authorAccountId = await getMyAccountId(env);
  const body = {
    issueId,
    authorAccountId,
    startDate,
    startTime: startTime || '09:00:00',
    timeSpentSeconds: Math.max(60, Math.round(timeSeconds)),
    description: description || '',
  };
  const res = await fetch(`https://api.tempo.io/4/worklogs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tempoToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Tempo ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function deleteWorklog({ id }, env) {
  const { tempoToken } = env;
  if (!tempoToken) throw new Error('TEMPO_TOKEN not configured');
  const res = await fetch(`https://api.tempo.io/4/worklogs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tempoToken}`, Accept: 'application/json' },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Tempo ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

module.exports = {
  createWorklog,
  updateWorklog,
  deleteWorklog,
  resolveIssueId,
  resolveIssueKeysBulk,
  getMyAccountId,
  searchIssues,
  fetchWorklogs,
  fetchWorklogsRange,
  getSuggestions,
};
