const fs   = require('fs');
const path = require('path');
const cache = require('./cache');

const TOKENS_FILE = path.join(__dirname, '..', '.google-tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

// ---------- token storage ----------
function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); }
  catch { return null; }
}
function saveTokens(t) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}
function clearTokens() {
  try { fs.unlinkSync(TOKENS_FILE); } catch {}
}
function getConnectionStatus() {
  const t = loadTokens();
  return { connected: Boolean(t && (t.access_token || t.refresh_token)) };
}

// ---------- OAuth ----------
function getAuthUrl(clientId, redirectUri) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
}

async function exchangeCode(clientId, clientSecret, redirectUri, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed: ${t.slice(0, 200)}`);
  }
  const tokens = await res.json();
  const stored = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 };
  saveTokens(stored);
  return stored;
}

async function getAccessToken(clientId, clientSecret) {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Google not connected');

  if (!tokens.access_token || tokens.expires_at - Date.now() < 60_000) {
    if (!tokens.refresh_token) throw new Error('Google refresh token missing — reconnect');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Google token refresh failed: ${t.slice(0, 200)}`);
    }
    const refreshed = await res.json();
    const updated = {
      access_token:  refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at:    Date.now() + (refreshed.expires_in || 3600) * 1000,
    };
    saveTokens(updated);
    return updated.access_token;
  }
  return tokens.access_token;
}

async function gGet(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Google API ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function pad(n) { return String(n).padStart(2, '0'); }

// ---------- Calendar ----------
async function fetchCalendarEvents({ year, month, refresh }, env) {
  const { googleClientId: cid, googleClientSecret: cs } = env;
  if (!cid || !cs) return { events: [], skipped: true, reason: 'Google not configured' };
  if (!loadTokens()) return { events: [], skipped: true, reason: 'Google not connected' };

  const key = `google:calendar:${year}-${pad(month)}`;
  if (!refresh) {
    const hit = cache.get(key, 60 * 60 * 1000);
    if (hit) return { events: hit, cached: true };
  }

  try {
    const token = await getAccessToken(cid, cs);
    const timeMin = new Date(year, month - 1, 1).toISOString();
    const timeMax = new Date(year, month, 0, 23, 59, 59).toISOString();
    const data = await gGet(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
      new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '2500' }),
      token,
    );

    const events = [];
    for (const item of (data.items || [])) {
      if (item.status === 'cancelled') continue;
      let time, kind;
      let duration = 0;
      if (item.start?.dateTime) {
        time = item.start.dateTime;
        const self = (item.attendees || []).find((a) => a.self);
        kind = self?.responseStatus === 'tentative' ? 'event-tentative' : 'event';
        if (item.end?.dateTime)
          duration = Math.round((new Date(item.end.dateTime) - new Date(item.start.dateTime)) / 1000);
      } else if (item.start?.date) {
        time = `${item.start.date}T00:00:00`;
        kind = 'event-all-day';
      } else continue;

      events.push({
        id:            item.id,
        time,
        kind,
        title:         item.summary || '(no title)',
        repoOrChannel: item.organizer?.displayName || item.organizer?.email || '',
        url:           item.htmlLink || null,
        source:        'calendar',
        duration,
      });
    }
    cache.set(key, events);
    return { events };
  } catch (err) {
    return { events: [], skipped: true, reason: err.message };
  }
}

// ---------- Gmail ----------
async function fetchGmailMessages({ year, month, refresh }, env) {
  const { googleClientId: cid, googleClientSecret: cs } = env;
  if (!cid || !cs) return { events: [], skipped: true, reason: 'Google not configured' };
  if (!loadTokens()) return { events: [], skipped: true, reason: 'Google not connected' };

  const key = `google:gmail:${year}-${pad(month)}`;
  if (!refresh) {
    const hit = cache.get(key, 15 * 60 * 1000);
    if (hit) return { events: hit, cached: true };
  }

  try {
    const token = await getAccessToken(cid, cs);
    const startEpoch = Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
    const endEpoch   = Math.floor(new Date(year, month, 1).getTime() / 1000);
    const q = `from:me after:${startEpoch} before:${endEpoch}`;

    const events = [];
    let pageToken = null;
    let pages = 0;
    do {
      const params = new URLSearchParams({ q, maxResults: '500' });
      if (pageToken) params.set('pageToken', pageToken);
      const listData = await gGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, token);
      const messages = listData.messages || [];

      const BATCH = 10;
      for (let i = 0; i < messages.length; i += BATCH) {
        const chunk = messages.slice(i, i + BATCH);
        const details = await Promise.all(chunk.map((m) =>
          gGet(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata` +
            `&metadataHeaders=Date&metadataHeaders=To&metadataHeaders=Subject`,
            token,
          ),
        ));
        for (const msg of details) {
          const headers = msg.payload?.headers || [];
          const h = (name) => headers.find((x) => x.name.toLowerCase() === name)?.value || '';
          let time;
          try { time = new Date(h('date')).toISOString(); } catch { continue; }
          if (!time || time === 'Invalid Date') continue;
          const toRaw   = h('to').split(',')[0].trim().replace(/<[^>]+>/, '').trim();
          events.push({
            id:            msg.id,
            time,
            kind:          'email-sent',
            title:         h('subject') || '(no subject)',
            repoOrChannel: toRaw || 'email',
            url:           `https://mail.google.com/mail/u/0/#sent/${msg.id}`,
            source:        'email',
          });
        }
      }
      pageToken = listData.nextPageToken || null;
      pages++;
    } while (pageToken && pages < 10);

    events.sort((a, b) => a.time.localeCompare(b.time));
    cache.set(key, events);
    return { events };
  } catch (err) {
    return { events: [], skipped: true, reason: err.message };
  }
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  clearTokens,
  getConnectionStatus,
  fetchCalendarEvents,
  fetchGmailMessages,
};
