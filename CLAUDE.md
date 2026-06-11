# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Start the server (node server/index.js), opens browser automatically
```

No build step, no tests, no linting configuration. The app runs directly from source.

To restart during development, kill the process and re-run `npm start`. The server listens on `PORT` (default 3333).

## Architecture

WorkPulse is a personal productivity tool that aggregates activity from GitHub, Slack, Google Calendar, and Gmail, then helps log time to Jira/Tempo.

**Stack:** Node.js 18+ Express backend + vanilla JS single-page frontend. No build tools, no frameworks, no TypeScript.

### Server (`server/`)

All routes are defined in `server/index.js`. Data fetchers are separate modules:

| Module | Responsibility |
|---|---|
| `github.js` | Fetches and hydrates user events (commits, PRs, reviews) with concurrent enrichment (6 workers) |
| `slack.js` | Searches sent messages via `search.messages`, resolves DM user IDs to display names |
| `google.js` | OAuth token management + Calendar events + Gmail sent messages |
| `tempo.js` | Jira issue resolution, worklog creation/update via Tempo Cloud API |
| `cache.js` | In-memory cache with TTL; persistent subset writes to `.cache.json` |
| `config-store.js` | Reads/writes `workpulse-config.json` (user credentials, overrides `.env`) |
| `mappings.js` | Maps GitHub repos / Slack channels / DMs → Jira project keys, stored in `mappings.json` |

**Config precedence:** `workpulse-config.json` values take precedence over `.env`. Both are merged at request time into an `env` object passed to each module.

**Primary endpoint:** `GET /api/events?year=X&month=Y&refresh=0|1` — runs all four fetchers in parallel via `Promise.allSettled()`, tolerating partial failures.

### Frontend (`client/`)

Vanilla JS ES modules (no bundler, `type="module"` in `index.html`). Shared state lives in `state.js`; cross-module render calls go through the `render` / `actions` callback registry in `render.js` (filled by `boot()`) to avoid circular imports.

**State shape** (`client/state.js`):
```js
state = {
  year, month,           // currently viewed month
  selected,              // YYYY-MM-DD of selected day
  events: { github, slack, calendar, email },
  dayIndex,              // per-day counts { 'YYYY-MM-DD': { gh, sl, em } }
  tempoByDay,            // local draft entries (persisted to localStorage)
  worklogs,              // real Tempo logs fetched from server
  mappings, favorites, health
}
```

**Client module map** — read only the file(s) relevant to your task:

| File | What's inside |
|---|---|
| `utils.js` | Pure helpers: date/time, duration, HTML escaping, Jira key extraction |
| `storage.js` | localStorage: `loadTempo/saveTempo(data)`, `loadFavorites/saveFavorites(data)`, issue title cache |
| `state.js` | `state` singleton (imports storage.js) |
| `render.js` | `render` + `actions` callback registry — breaks circular import chains |
| `api.js` | `api(path, opts)` fetch wrapper |
| `helpers.js` | `projectFor`, `issueKeyFromMapping`, `rebuildDayIndex` (need state.mappings) |
| `calendar.js` | `renderStatusPill`, `renderCalendar`, `renderWeeklySummary` |
| `timeline.js` | Two-column day layout: bubbles, lane layout, event merging, drag-to-create, `renderDay` |
| `tempo-panel.js` | Issue autocomplete, draft entries, `addEventToTempo`, `renderTempo`, `sendTempo` |
| `favorites.js` | Favorites panel + suggestions modal |
| `settings.js` | Settings + Mappings modals |
| `onboarding.js` | Onboarding wizard + feature tour |
| `app.js` | Data loading (`loadHealth/Events/Worklogs`), navigation (`selectDay`, `shiftDay`), `toast`, `boot()` |
| `demo.js` | Fictional dataset for `?demo=1` mode |

**Callback pattern:** modules that trigger cross-module renders call `render.day()`, `render.tempo()`, etc. or `actions.toast()`, `actions.selectDay()`. `boot()` in `app.js` fills all callbacks with the real functions before data loading starts.

**Persistent state:** `localStorage` keys `workpulse:tempo` (drafts) and `workpulse:favorites`.

**Rendering pattern:** Declarative HTML string generation (no VDOM). Key render functions:
- `renderCalendar()` — monthly mini-calendar with per-day event dots (`calendar.js`)
- `renderWeeklySummary()` — left sidebar: logged hours per project + draft totals (`calendar.js`)
- `renderDay()` — two-column timeline + Tempo column for selected day (`timeline.js`)
- `renderTempo()` — right panel draft entries (`tempo-panel.js`)

**Filter state:** `timelineFilters` (module-level `Set` in `timeline.js`) controls which sources appear in the center timeline. Calendar events are intentionally excluded from the timeline and mini-calendar dots — they appear only in the Tempo column as `.wb-meeting` blocks.

**Key utilities** (all in `utils.js`):
- `parseDuration(str)` — flexible parsing: "90m", "1h 30m", "1.5h", plain number (minutes)
- `formatDuration(seconds)` — "1h 30m" / "45m"
- `hhmm(isoString)` — extract HH:MM from ISO datetime
- `localDay(isoString)` — YYYY-MM-DD in local time

**Event-to-draft flow:**
1. User clicks an event bubble in the timeline (`timeline.js` → `actions.addEventToTempo`)
2. `addEventToTempo(event)` in `tempo-panel.js` creates a draft in `state.tempoByDay[date]`
3. Draft gets `sourceIds: [event.id]` for deduplication
4. `render.day()` + `render.tempo()` re-render both panels
5. "Send to Tempo" (`sendTempo` in `tempo-panel.js`) calls `POST /api/tempo`

## Key files for common tasks

- Adding a new data source: add fetcher module in `server/`, call it in `/api/events` in `server/index.js`, extend `state.events` and `buildDayTimeline()` in `client/timeline.js`
- Timeline layout changes: `client/timeline.js` + `client/styles.css`
- Tempo panel / draft entries: `client/tempo-panel.js`
- Settings or Mappings modal: `client/settings.js` + `client/index.html`
- Onboarding wizard or feature tour: `client/onboarding.js`
- Favorites panel: `client/favorites.js`
- New API endpoint: `server/index.js`
- Credential/config fields: `server/config-store.js` whitelist + `client/settings.js` + `client/onboarding.js`

## Gitignored sensitive files

`.env`, `workpulse-config.json`, `.google-tokens.json`, `.cache.json`, `mappings.json` — none of these should ever be committed.
