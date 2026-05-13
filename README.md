# WorkPulse

Personal productivity tool that aggregates daily activity from GitHub, Slack, Google Calendar, and Gmail, then helps log time to Jira/Tempo.

Runs locally as a Node.js server — no cloud, no database, credentials stay on your machine.

## Features

- **Timeline view** — unified chronological view of GitHub commits, PRs, Slack messages, and calendar meetings per day
- **Tempo logging** — drag meetings or click events to create draft log entries, send to Tempo in one click
- **Smart suggestions** — recent issues, favorites, and Jira search autocomplete while typing an issue key
- **Calendar awareness** — accepted/tentative/declined meeting states, overlap deduplication
- **Mappings** — map GitHub repos and Slack channels to Jira project keys for automatic prefilling

## Installation

```bash
git clone <repo>
cd workpulse
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your credentials, or use the in-app Settings / Onboarding wizard on first launch.

```env
GITHUB_TOKEN=ghp_xxx
GITHUB_USERNAME=yourhandle
SLACK_TOKEN=xoxp-xxx
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@yourorg.com
JIRA_API_TOKEN=xxx
TEMPO_TOKEN=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
```

Google Calendar and Gmail require OAuth — connect via Settings after filling in the client credentials.

## Running

```bash
npm start        # starts server on localhost:3333, opens browser automatically
```

## Demo mode

To preview the app with fictional data (no credentials needed):

```
http://localhost:3333/?demo=1
```

Shows a sample day with GitHub commits, Slack messages, calendar meetings (accepted and tentative), real Tempo worklogs, and a draft entry — useful for screenshots or onboarding colleagues.

## Distribution (macOS app)

Build a standalone `.dmg` that colleagues can install without Node.js:

```bash
npm run dist          # builds arm64 + x64 DMG into dist/
npm run electron      # run locally as Electron app (dev)
```

Distributing without an Apple Developer certificate: recipients right-click the `.app` → Open on first launch.

User data (credentials, mappings, cache) is stored in `~/Library/Application Support/WorkPulse/` — separate from the app bundle and survives updates.

## Project structure

```
server/
  index.js          Express server + all API routes
  github.js         GitHub Events API fetcher
  slack.js          Slack search.messages proxy
  google.js         Google OAuth + Calendar + Gmail
  tempo.js          Jira issue search + Tempo worklog CRUD
  cache.js          In-memory cache with optional persistence
  config-store.js   Reads/writes workpulse-config.json
  mappings.js       Repo/channel → Jira project key mappings
  data-dir.js       Resolves user data path (local vs Electron)
client/
  index.html
  app.js            Single-file vanilla JS frontend (~2 500 lines)
  styles.css
electron/
  main.js           Electron entry point
```
