const fs = require('fs');
const path = require('path');

const store = new Map();
const persistFile = path.join(__dirname, '..', '.cache.json');
const persistKeys = new Set();

try {
  if (fs.existsSync(persistFile)) {
    const data = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
    for (const [k, v] of Object.entries(data || {})) {
      store.set(k, { t: Date.now(), v });
      persistKeys.add(k);
    }
  }
} catch { /* ignore */ }

let writeTimer = null;
function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const out = {};
    for (const k of persistKeys) {
      const e = store.get(k);
      if (e) out[k] = e.v;
    }
    try { fs.writeFileSync(persistFile, JSON.stringify(out), 'utf8'); }
    catch { /* ignore */ }
  }, 500);
}

function persist(key, value) {
  store.set(key, { t: Date.now(), v: value });
  persistKeys.add(key);
  schedulePersist();
}

function get(key, ttlMs) {
  const entry = store.get(key);
  if (!entry) return null;
  if (ttlMs && Date.now() - entry.t > ttlMs) {
    store.delete(key);
    return null;
  }
  return entry.v;
}

function set(key, value) {
  store.set(key, { t: Date.now(), v: value });
}

function invalidate(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      persistKeys.delete(k);
    }
  }
  schedulePersist();
}

module.exports = { get, set, persist, invalidate };
