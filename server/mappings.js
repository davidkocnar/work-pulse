const fs = require('fs');
const path = require('path');
const dataDir = require('./data-dir');

const FILE = path.join(dataDir(), 'mappings.json');

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  if (!Array.isArray(list)) throw new Error('mappings must be an array');
  const allowed = new Set(['github', 'slack', 'slack-dm', 'calendar']);
  const cleaned = list
    .filter((m) => m && m.key && m.project && allowed.has(m.type))
    .map((m) => ({
      type: m.type,
      key: String(m.key).trim(),
      project: String(m.project).trim().toUpperCase(),
    }));
  fs.writeFileSync(FILE, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
  return cleaned;
}

function resolveProject(mappings, type, key) {
  if (!key) return null;
  const lowerKey = String(key).toLowerCase();
  const exact = mappings.find((m) => m.type === type && m.key.toLowerCase() === lowerKey);
  return exact ? exact.project : null;
}

module.exports = { read, write, resolveProject };
