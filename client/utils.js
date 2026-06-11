// Pure utility functions — no state, no DOM, no side effects.

export const KIND_LABELS = {
  commit: 'commit',
  'pr-opened': 'PR opened',
  'pr-closed': 'PR closed',
  'pr-merged': 'PR merged',
  'pr-reopened': 'PR reopened',
  'pr-edited': 'PR edited',
  'review-approved': 'approved',
  'review-changes-requested': 'changes',
  'review-commented': 'review',
  'review-comment': 'review note',
  'pr-comment': 'PR comment',
  'issue-comment': 'issue comment',
  'branch-created': 'new branch',
  message: 'msg',
  dm: 'dm',
  mpim: 'group dm',
  event: 'meeting',
  'event-tentative': 'tentative',
  'event-no-response': 'no response',
  'event-declined': 'declined',
  'event-all-day': 'all day',
  'email-sent': 'email',
};

// ---------- String / HTML ----------

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function cryptoId() {
  return 'e_' + Math.random().toString(36).slice(2, 10);
}

// ---------- Date / time ----------

export function pad(n) { return String(n).padStart(2, '0'); }

export function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISO(s) { return new Date(s); }

export function localDay(iso) {
  return ymd(parseISO(iso));
}

export function hhmm(iso) {
  const d = parseISO(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeToMinutesOfDay(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

export function monthName(year, month) {
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export function dayLong(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ---------- Duration ----------

export function parseDuration(input) {
  if (!input) return 0;
  const s = String(input).trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60;
  if (/^\d+\.\d+$/.test(s)) return Math.round(parseFloat(s) * 3600);
  let total = 0;
  const re = /(\d+(?:\.\d+)?)\s*(h|m)/g;
  let match, found = false;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const v = parseFloat(match[1]);
    total += match[2] === 'h' ? v * 3600 : v * 60;
  }
  return found ? Math.round(total) : 0;
}

export function formatDuration(seconds) {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// ---------- Source context ----------

export function parseMpimNames(mpimRaw) {
  let s = mpimRaw.startsWith('mpdm-') ? mpimRaw.slice(5) : mpimRaw;
  s = s.replace(/-\d+$/, '');
  return s.split('--').filter(Boolean).map((n) => n.split('.')[0]);
}

export function ctxShort(source, repoOrChannel) {
  const raw = repoOrChannel || '';
  if (source === 'github') {
    const slash = raw.lastIndexOf('/');
    return slash >= 0 ? raw.slice(slash + 1) : raw;
  }
  if (source === 'slack') {
    if (raw.startsWith('dm:'))   return raw.slice(3);
    if (raw.startsWith('mpim:')) return parseMpimNames(raw.slice(5)).join(', ');
    return '#' + raw;
  }
  if (source === 'email') {
    const at = raw.indexOf('@');
    return at >= 0 ? raw.slice(0, at) : raw;
  }
  return raw;
}

export function ctxHtml(source, repoOrChannel) {
  const raw = repoOrChannel || '?';
  if (source === 'slack') {
    if (raw.startsWith('dm:'))   return `<span class="ctx ctx-sl">↗ ${escapeHtml(raw.slice(3))}</span>`;
    if (raw.startsWith('mpim:')) return `<span class="ctx ctx-sl">⊕ ${escapeHtml(parseMpimNames(raw.slice(5)).join(', '))}</span>`;
    return `<span class="ctx ctx-sl"># ${escapeHtml(raw)}</span>`;
  }
  if (source === 'github') {
    const slash = raw.lastIndexOf('/');
    const repo  = slash >= 0 ? raw.slice(slash + 1) : raw;
    return `<span class="ctx ctx-gh">${escapeHtml(repo)}</span>`;
  }
  if (source === 'calendar') return `<span class="ctx ctx-cal">${escapeHtml(raw)}</span>`;
  if (source === 'email')    return `<span class="ctx ctx-email">${escapeHtml(raw)}</span>`;
  return `<span class="ctx">${escapeHtml(raw)}</span>`;
}

// ---------- Jira issue key ----------

export function extractIssueKey(text) {
  if (!text) return null;
  const m = String(text).match(/\b([A-Z][A-Z0-9]+)-(\d+)\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function buildDescription(ev) {
  if (ev.source === 'github') {
    if (ev.kind === 'commit') return ev.title;
    const lbl = KIND_LABELS[ev.kind] || ev.kind;
    if (ev.prNumber) return `${lbl}: ${ev.title} (#${ev.prNumber})`;
    if (ev.branch && ev.kind === 'branch-created') return `branch ${ev.branch}`;
    return `${lbl}: ${ev.title}`;
  }
  if (ev.source === 'slack') {
    const ch = ev.repoOrChannel || '';
    return ch.startsWith('dm:') ? `Slack DM: ${ch.slice(3)}` : `Slack #${ch}`;
  }
  if (ev.source === 'email') {
    const to = ev.repoOrChannel || '';
    return to ? `To: ${to} · ${ev.title || ''}` : ev.title || '';
  }
  return ev.title || '';
}
