const cache = require('./cache');

const TTL_MS = 5 * 60 * 1000;
const HYDRATE_TTL_MS = 24 * 60 * 60 * 1000;
const PER_PAGE = 100;
const MAX_PAGES = 10;
const HYDRATE_CONCURRENCY = 6;

async function ghFetch(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'WorkPulse',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Hydration cache: per-URL JSON, persisted in the in-memory cache module.
async function fetchCached(url, token) {
  const cached = cache.get(`gh:hyd:${url}`, HYDRATE_TTL_MS);
  if (cached !== null) return cached;
  let data = null;
  try {
    data = await ghFetch(url, token);
  } catch {
    data = null;
  }
  cache.set(`gh:hyd:${url}`, data);
  return data;
}

function shortenSha(sha) { return (sha || '').slice(0, 7); }
function stripBranch(ref) { return ref ? ref.replace(/^refs\/heads\//, '') : null; }
function isZeroSha(sha) { return !sha || /^0+$/.test(sha); }

async function hydrate(events, token) {
  const tasks = events.map((ev) => async () => {
    const repo = ev.repo && ev.repo.name;
    if (!repo) return;
    const p = ev.payload || {};

    if (ev.type === 'PullRequestEvent' || ev.type === 'PullRequestReviewEvent' || ev.type === 'PullRequestReviewCommentEvent') {
      if (p.pull_request && p.pull_request.url) {
        ev._pr = await fetchCached(p.pull_request.url, token);
      }
    } else if (ev.type === 'IssueCommentEvent') {
      if (p.issue && p.issue.url) {
        ev._issue = await fetchCached(p.issue.url, token);
      }
    } else if (ev.type === 'PushEvent') {
      const before = p.before;
      const head = p.head;
      if (head && before && !isZeroSha(before)) {
        const url = `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(before)}...${encodeURIComponent(head)}`;
        ev._compare = await fetchCached(url, token);
      } else if (head) {
        const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(head)}`;
        ev._commit = await fetchCached(url, token);
      }
    }
  });

  const queue = tasks.slice();
  const workers = Array.from({ length: HYDRATE_CONCURRENCY }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try { await t(); } catch { /* swallow per-event */ }
    }
  });
  await Promise.all(workers);
}

function transform(event) {
  const time = event.created_at;
  const repo = event.repo && event.repo.name;
  const repoUrl = repo ? `https://github.com/${repo}` : null;
  const base = { id: event.id, time, source: 'github', repoOrChannel: repo };
  const p = event.payload || {};

  switch (event.type) {
    case 'PushEvent': {
      const branch = stripBranch(p.ref);
      // Prefer commits from compare API if hydrated
      const commits = (event._compare && event._compare.commits)
        || (event._commit ? [event._commit] : []);
      if (commits.length === 0) {
        // Fallback: synthesize a single entry with just the head SHA
        if (p.head) {
          return [{
            ...base,
            id: `${event.id}-${p.head}`,
            kind: 'commit',
            title: `push to ${branch || 'branch'} (${shortenSha(p.head)})`,
            branch,
            sha: shortenSha(p.head),
            url: repo ? `${repoUrl}/commit/${p.head}` : null,
          }];
        }
        return [];
      }
      return commits.map((c, i) => {
        const sha = c.sha || c.id || (c.commit && c.commit.tree && c.commit.tree.sha);
        const message = (c.commit && c.commit.message) || c.message || '';
        const htmlUrl = c.html_url || (sha && repo ? `${repoUrl}/commit/${sha}` : null);
        return {
          ...base,
          id: `${event.id}-${sha || i}`,
          kind: 'commit',
          title: message.split('\n')[0] || `commit ${shortenSha(sha)}`,
          body: message,
          branch,
          url: htmlUrl,
          sha: shortenSha(sha),
        };
      });
    }
    case 'PullRequestEvent': {
      const pr = event._pr || p.pull_request || {};
      const action = p.action;
      const merged = action === 'closed' && pr.merged;
      return [{
        ...base,
        kind: merged ? 'pr-merged' : `pr-${action}`,
        title: pr.title || `PR #${p.number || pr.number || ''}`,
        url: pr.html_url || (repo && p.number ? `${repoUrl}/pull/${p.number}` : null),
        prNumber: pr.number || p.number,
        branch: pr.head && pr.head.ref,
      }];
    }
    case 'PullRequestReviewEvent': {
      const pr = event._pr || p.pull_request || {};
      const review = p.review || {};
      const state = (review.state || '').toLowerCase().replace(/_/g, '-') || 'commented';
      return [{
        ...base,
        kind: `review-${state}`,
        title: pr.title || `PR #${pr.number || ''}`,
        url: review.html_url || pr.html_url,
        prNumber: pr.number,
        body: review.body,
      }];
    }
    case 'PullRequestReviewCommentEvent': {
      const pr = event._pr || p.pull_request || {};
      const c = p.comment || {};
      return [{
        ...base,
        kind: 'review-comment',
        title: pr.title || `PR #${pr.number || ''}`,
        url: c.html_url,
        prNumber: pr.number,
        body: c.body,
      }];
    }
    case 'IssueCommentEvent': {
      const issue = event._issue || p.issue || {};
      const c = p.comment || {};
      return [{
        ...base,
        kind: issue.pull_request ? 'pr-comment' : 'issue-comment',
        title: issue.title || `#${issue.number || ''}`,
        url: c.html_url,
        prNumber: issue.number,
        body: c.body,
      }];
    }
    case 'CreateEvent': {
      if (p.ref_type !== 'branch') return [];
      return [{
        ...base,
        kind: 'branch-created',
        title: `Branch ${p.ref}`,
        branch: p.ref,
        url: repo ? `${repoUrl}/tree/${encodeURIComponent(p.ref)}` : null,
      }];
    }
    default:
      return [];
  }
}

function monthBounds(year, month) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
  };
}

async function fetchEvents({ year, month, token, username, refresh }) {
  if (!token || !username) return { events: [], skipped: true, reason: 'GitHub not configured' };
  const key = `github:${username}:${year}-${String(month).padStart(2, '0')}`;
  if (!refresh) {
    const cached = cache.get(key, TTL_MS);
    if (cached) return { events: cached, cached: true };
  }

  const { start, end } = monthBounds(year, month);
  const raw = [];
  let stopped = false;

  for (let page = 1; page <= MAX_PAGES && !stopped; page++) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/events?per_page=${PER_PAGE}&page=${page}`;
    let batch;
    try {
      batch = await ghFetch(url, token);
    } catch (e) {
      if (raw.length === 0) throw e;
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const ev of batch) {
      const t = new Date(ev.created_at);
      if (t < start) { stopped = true; break; }
      if (t >= end) continue;
      raw.push(ev);
    }
    if (batch.length < PER_PAGE) break;
  }

  await hydrate(raw, token);

  const out = [];
  for (const ev of raw) out.push(...transform(ev));
  out.sort((a, b) => new Date(a.time) - new Date(b.time));

  cache.set(key, out);
  return { events: out, cached: false };
}

module.exports = { fetchEvents };
