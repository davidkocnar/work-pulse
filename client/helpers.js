import { state } from './state.js';
import { localDay } from './utils.js';

// ---------- helpers ----------

export function projectFor(event) {
  if (!state.mappings.length) return null;
  if (event.source === 'github') {
    const m = state.mappings.find((x) => x.type === 'github' && x.key.toLowerCase() === (event.repoOrChannel || '').toLowerCase());
    return m ? m.project : null;
  }
  if (event.source === 'slack') {
    const ch = event.repoOrChannel || '';
    if (ch.startsWith('dm:')) {
      const name = ch.slice(3).toLowerCase();
      const m = state.mappings.find((x) => x.type === 'slack-dm' && x.key.toLowerCase() === name);
      return m ? m.project : null;
    }
    const m = state.mappings.find((x) => x.type === 'slack' && x.key.toLowerCase() === ch.toLowerCase());
    return m ? m.project : null;
  }
  if (event.source === 'calendar') {
    const title = (event.title || '').trim();
    const m = state.mappings.find((x) => x.type === 'calendar' && x.key.toLowerCase() === title.toLowerCase());
    return m ? m.project : null;
  }
  return null;
}

// Returns full issue key if mapping holds one (e.g. "FTL-123"), else a "PROJ-" prefix, else ''.
export function issueKeyFromMapping(event) {
  const mapped = projectFor(event);
  if (!mapped) return '';
  return /^[A-Z][A-Z0-9]+-\d+$/.test(mapped) ? mapped : `${mapped}-`;
}

export function rebuildDayIndex() {
  const idx = {};
  const day = (e) => { const d = localDay(e.time); return (idx[d] ||= { gh: 0, sl: 0, em: 0 }); };
  for (const e of state.events.github)           day(e).gh++;
  for (const e of state.events.slack)            day(e).sl++;
  for (const e of (state.events.email || []))    day(e).em++;
  state.dayIndex = idx;
}
