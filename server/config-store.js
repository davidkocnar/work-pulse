const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'workpulse-config.json');

const ALLOWED = new Set([
  'GITHUB_TOKEN', 'GITHUB_USERNAME',
  'SLACK_TOKEN',
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

module.exports = { read, write };
