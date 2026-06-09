const fs = require('fs');
const path = require('path');
const dataDir = require('./data-dir');

const FILE = path.join(dataDir(), 'workpulse-config.json');

const ALLOWED = new Set([
  'GITHUB_TOKEN', 'GITHUB_USERNAME', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'SLACK_TOKEN', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
  'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN',
  'TEMPO_TOKEN',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
]);

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function write(incoming = {}) {
  const out = {};
  for (const key of ALLOWED) {
    const v = incoming[key];
    if (v !== undefined && v !== '') out[key] = String(v);
  }
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  return out;
}

// Merge incoming keys into existing config (doesn't erase keys not in incoming).
function merge(incoming = {}) {
  const existing = read();
  const out = { ...existing };
  for (const key of ALLOWED) {
    const v = incoming[key];
    if (v !== undefined && v !== '') out[key] = String(v);
  }
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  return out;
}

function remove(keys = []) {
  const existing = read();
  for (const key of keys) delete existing[key];
  fs.writeFileSync(FILE, JSON.stringify(existing, null, 2));
  return existing;
}

module.exports = { read, write, merge, remove };
