const cache = require('./cache');

const TTL_MS = 5 * 60 * 1000;
const PER_PAGE = 100;
const MAX_PAGES = 20;

const SLACK_ERROR_MESSAGES = {
  invalid_auth:      'Invalid Slack token — check your token in Settings.',
  not_authed:        'Slack token missing — add your token in Settings.',
  account_inactive:  'Slack account is inactive.',
  token_revoked:     'Slack token has been revoked — generate a new one in Settings.',
  no_permission:     'Slack token lacks the required permission scope.',
  missing_scope:     'Slack token lacks the required permission scope.',
  ratelimited:       'Slack rate limit reached — try again in a moment.',
};

async function slackCall(method, params, token) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Slack HTTP error ${res.status}.`);
  }
  const data = await res.json();
  if (!data.ok) {
    const code = data.error || 'unknown';
    throw new Error(SLACK_ERROR_MESSAGES[code] || `Slack error: ${code}.`);
  }
  return data;
}

function pad(n) { return String(n).padStart(2, '0'); }

function shorten(text, n = 150) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1) + '…' : flat;
}

async function resolveUserName(userId, token) {
  if (!userId) return null;
  const cached = cache.get(`slack:user:${userId}`, 24 * 60 * 60 * 1000);
  if (cached !== null) return cached;
  try {
    const data = await slackCall('users.info', { user: userId }, token);
    const u = data.user || {};
    const name = (u.profile && (u.profile.display_name_normalized || u.profile.real_name_normalized))
      || u.real_name || u.name || userId;
    cache.set(`slack:user:${userId}`, name);
    return name;
  } catch {
    cache.set(`slack:user:${userId}`, userId);
    return userId;
  }
}

function transform(match) {
  const tsSec = Math.floor(parseFloat(match.ts || '0'));
  const time = new Date(tsSec * 1000).toISOString();
  const channel = match.channel || {};
  let label = channel.name || channel.id || '?';
  let kind = 'message';
  if (channel.is_im) { label = `dm:${channel.user || channel.name}`; kind = 'dm'; }
  else if (channel.is_mpim) { label = `mpim:${channel.name || channel.id}`; kind = 'mpim'; }
  return {
    id: `${channel.id || 'X'}-${match.ts}`,
    time,
    source: 'slack',
    kind,
    repoOrChannel: label,
    channelId: channel.id,
    isIm: !!channel.is_im,
    imUserId: channel.is_im ? (channel.user || channel.name) : null,
    title: shorten(match.text, 150),
    body: match.text,
    url: match.permalink,
  };
}

async function fetchMessages({ year, month, token, refresh }) {
  if (!token) return { events: [], skipped: true, reason: 'Slack not configured' };
  const key = `slack:${year}-${pad(month)}`;
  if (!refresh) {
    const cached = cache.get(key, TTL_MS);
    if (cached) return { events: cached, cached: true };
  }

  // Slack search uses local-day boundaries; after/before are exclusive.
  const startBound = new Date(Date.UTC(year, month - 1, 1));
  const endBound = new Date(Date.UTC(year, month, 1));
  const dayBefore = new Date(startBound.getTime() - 24 * 3600 * 1000);
  const after = `${dayBefore.getUTCFullYear()}-${pad(dayBefore.getUTCMonth() + 1)}-${pad(dayBefore.getUTCDate())}`;
  const before = `${endBound.getUTCFullYear()}-${pad(endBound.getUTCMonth() + 1)}-${pad(endBound.getUTCDate())}`;

  const query = `from:me after:${after} before:${before}`;
  const out = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await slackCall('search.messages', {
      query,
      count: PER_PAGE,
      page,
      sort: 'timestamp',
      sort_dir: 'asc',
    }, token);
    const matches = (data.messages && data.messages.matches) || [];
    for (const m of matches) {
      const t = new Date(parseFloat(m.ts || '0') * 1000);
      if (t < startBound || t >= endBound) continue;
      out.push(transform(m));
    }
    const paging = (data.messages && data.messages.paging) || {};
    if (!paging.pages || page >= paging.pages) break;
  }

  // Resolve DM user IDs to display names so the channel column is meaningful.
  const userIds = Array.from(new Set(out.filter((m) => m.isIm && m.imUserId).map((m) => m.imUserId)));
  const names = {};
  await Promise.all(userIds.map(async (uid) => {
    names[uid] = await resolveUserName(uid, token);
  }));
  for (const m of out) {
    if (m.isIm && m.imUserId && names[m.imUserId]) {
      m.repoOrChannel = `dm:${names[m.imUserId]}`;
    }
  }

  out.sort((a, b) => new Date(a.time) - new Date(b.time));
  cache.set(key, out);
  return { events: out, cached: false };
}

module.exports = { fetchMessages };
