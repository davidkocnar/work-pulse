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

Single file: `client/app.js` (~77KB, no bundler). Vanilla JS with a module-scoped `state` object:

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

**Persistent state:** `localStorage` keys `workpulse:tempo` (drafts) and `workpulse:favorites`.

**Rendering pattern:** Declarative HTML string generation (no VDOM). Key render functions:
- `renderCalendar()` — monthly mini-calendar with per-day event dots
- `renderWeeklySummary()` — left sidebar: logged hours per project + draft totals
- `buildDayTimeline(day)` → `renderTimeline()` → `renderTimelineRow()` — chronological unified timeline in the center panel
- `renderTempo()` — right panel draft entries

**Filter state:** `timelineFilters` (module-level `Set`) controls which sources appear in the center timeline. Calendar events are intentionally excluded from the timeline and mini-calendar dots — they appear only in the right Tempo panel as `.wb-meeting` blocks.

**Key utilities:**
- `parseDuration(str)` — flexible parsing: "90m", "1h 30m", "1.5h", plain number (minutes)
- `formatDuration(seconds)` — "1h 30m" / "45m"
- `hhmm(isoString)` — extract HH:MM from ISO datetime
- `localDay(isoString)` — YYYY-MM-DD in local time
- `projectFor(event)` — looks up Jira project key from mappings

**Event-to-draft flow:**
1. User clicks an event row in the timeline
2. `addEventToTempo(event)` creates a draft entry in `state.tempoByDay[date]`
3. Draft gets `sourceIds: [event.id]` for deduplication
4. `renderDay()` marks the row `.added` and shows a `.logged-tag` inline
5. "Send to Tempo" calls `POST /api/tempo` for each draft entry

## Key files for common tasks

- Adding a new data source: add fetcher module in `server/`, call it in the `/api/events` handler in `server/index.js`, extend `state.events` and `buildDayTimeline()` in `client/app.js`
- UI changes: `client/app.js` (logic) + `client/styles.css` (styles) + `client/index.html` (structure)
- New API endpoint: `server/index.js`
- Credential/config fields: `server/config-store.js` whitelist + settings modal in `client/index.html` + `client/app.js` settings save/load

## Gitignored sensitive files

`.env`, `workpulse-config.json`, `.google-tokens.json`, `.cache.json`, `mappings.json` — none of these should ever be committed.
