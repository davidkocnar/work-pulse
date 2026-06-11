# WorkPulse

Personal productivity tool that aggregates daily activity from GitHub, Slack, Google Calendar, and Gmail, then helps log time to Jira/Tempo.

Runs entirely locally — no cloud, no database, credentials stay on your machine.

## Features

- **Timeline view** — unified chronological view of GitHub commits, PRs, Slack messages, and calendar meetings per day
- **Tempo logging** — drag meetings or click events to create draft log entries, send to Tempo in one click
- **Smart suggestions** — recent issues, favorites, and Jira search autocomplete while typing an issue key
- **Calendar awareness** — accepted/tentative/declined meeting states, overlap deduplication
- **Mappings** — map GitHub repos and Slack channels to Jira project keys for automatic prefilling

---

## Install — macOS app (recommended)

Download the latest `.dmg` from the [Releases page](../../releases/latest), open it, and drag WorkPulse to Applications.

On first launch macOS may ask you to confirm — right-click the app → **Open**.

OAuth for GitHub, Slack, and Google is pre-configured in the app. The onboarding wizard walks you through connecting each service. You only need to provide your personal **Jira and Tempo tokens**:

| Token | Where to get it |
|---|---|
| Jira API token | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → Create API token |
| Tempo token | [Tempo → API Integration](https://thefuntasty.atlassian.net/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration/api-integration) → New Token — enable `worklogs:read` and `worklogs:write` |

User data (credentials, mappings, drafts) is stored in `~/Library/Application Support/WorkPulse/` — survives app updates.

---

## Install — run from source (developers)

Requires **Node.js 18+**.

```bash
git clone <repo-url>
cd workpulse
npm install
```

Copy `.env.example` to `.env` and fill in the OAuth app credentials (ask the team for the shared values).

```bash
npm start   # starts server on localhost:3333, opens browser automatically
```

OAuth for GitHub, Slack, and Google works the same way as in the DMG — connect via the in-app Settings or onboarding wizard.

---

## Demo mode

Preview the app with fictional data — no credentials needed:

```
http://localhost:3333/?demo=1
```

Shows a sample day with GitHub commits, Slack messages, calendar meetings, and Tempo worklogs. Useful for screenshots or showing the app to someone new.

---

## Build and release DMG

Requires the OAuth credentials in `.env` (they get bundled into the app so users don't need them).

```bash
npm run dist          # builds arm64 + x64 DMG into dist/
npm run electron      # run as Electron app locally (dev)
```

**Publishing a new release:**

1. Bump `version` in `package.json`, commit and push
2. On GitHub: **Releases → Draft a new release → Create a new tag** (e.g. `v1.9`) → **Publish release**
3. GitHub Actions builds the DMG automatically and attaches it to the release

Colleagues then always find the latest version at the Releases page.

> **First-time setup:** add the six OAuth credentials as repository secrets under **Settings → Secrets → Actions**:
> `APP_GITHUB_CLIENT_ID`, `APP_GITHUB_CLIENT_SECRET`, `APP_SLACK_CLIENT_ID`, `APP_SLACK_CLIENT_SECRET`, `APP_GOOGLE_CLIENT_ID`, `APP_GOOGLE_CLIENT_SECRET`

---

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
  app.js            Single-file vanilla JS frontend
  styles.css
electron/
  main.js           Electron entry point
  preload.js        Context bridge (fullscreen detection)
```
