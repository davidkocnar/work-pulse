// ---------- localStorage persistence ----------

export const issueTitleCache = (() => {
  try { return new Map(JSON.parse(localStorage.getItem('workpulse:issueTitles') || '[]')); }
  catch { return new Map(); }
})();

export function cacheIssueTitle(key, title) {
  if (!key || !title) return;
  issueTitleCache.set(key, title);
  try { localStorage.setItem('workpulse:issueTitles', JSON.stringify([...issueTitleCache])); } catch {}
}

export function loadTempo() {
  try { return JSON.parse(localStorage.getItem('workpulse:tempo') || '{}'); }
  catch { return {}; }
}

export function saveTempo(tempoByDay) {
  localStorage.setItem('workpulse:tempo', JSON.stringify(tempoByDay));
}

export function loadFavorites() {
  try {
    const arr = JSON.parse(localStorage.getItem('workpulse:favorites') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveFavorites(favorites) {
  localStorage.setItem('workpulse:favorites', JSON.stringify(favorites));
}
