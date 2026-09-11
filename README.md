# study-orbit# Study Orbit

**Everything Around Your Progress.**

A premium, fully client-side study productivity app — session timer, analytics, tasks, notes, sleep tracking, and focus music, all in one place. No backend, no build step, no dependencies to install. Open `index.html` and it runs.

---

## Features

- **Study Timer** — timestamp-based (not a `setInterval` counter), so it survives a page refresh mid-session without losing time. Includes a fullscreen Focus Mode with a persistent minimizable music player.
- **Dashboard** — a personalized greeting and a real, data-driven insight pulled from your actual history (never a generic message). Weekly stats run Monday–Sunday and reset every Monday.
- **Analytics** — Chart.js trends (daily study time, subject distribution, study-type distribution) with a working date-range filter.
- **Subjects, Tasks, Notes** — full CRUD, autosaving notes (debounced, IndexedDB-backed for content).
- **Sleep tracking** — overnight-aware duration math, consistency/trend charts, and a rule-based Smart Analysis engine — including a real sleep × study correlation.
- **Smart Insights** — every insight anywhere in the app (Dashboard, Analytics, Sleep) is computed from real stored data through rule engines with minimum-data guards. Nothing is templated or randomized.
- **Music player** — paste a YouTube link, organize into playlists, persistent floating widget that keeps playing while minimized.
- **Import / Export** — full JSON backup with a preview step before merge/replace.
- **Settings** — profile name, daily/weekly goals, a genuinely wired sound-on-complete toggle.
- **PWA-ready** — installable, works offline for previously visited pages, proper manifest/favicon/social-preview tags.

## Tech Stack

Vanilla JavaScript (ES modules), Tailwind CSS (via CDN, utility layer only — the actual design system lives in `css/tokens.css`), Chart.js, [Lucide](https://lucide.dev) icons. No React, no bundler, no npm install required to run the app.

## Getting Started

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

That's it — there's no build step. Everything (`css/`, `js/`, `manifest.json`, `sw.js`) is loaded directly by the browser.

### Before your first real deploy

Drop a `logo.png` into `assets/`. Every icon reference in the app — sidebar logo, favicon, PWA icons, social-preview image — already points at `assets/logo.png` and will pick it up automatically with no code changes.

## Project Structure

```
study-orbit/
├── index.html              App shell
├── test.html                Standalone placeholder page (linked from the sidebar's "Test Analysis" item)
├── manifest.json             PWA manifest
├── sw.js                     Service worker (app-shell caching)
├── package.json               No dependencies — only lets `npm test` resolve ES module imports
│
├── assets/                    Put your logo.png here
│
├── css/
│   ├── tokens.css              Design tokens — colors, spacing, radii, motion (the actual design system)
│   ├── style.css                Component styles
│   ├── animations.css            Motion + prefers-reduced-motion handling
│   └── responsive.css             Mobile breakpoints
│
├── js/
│   ├── app.js                    Boot sequence, sidebar, routing setup
│   │
│   ├── core/                      Framework-agnostic foundation
│   │   ├── schema.js                Data shapes + validators (single source of truth)
│   │   ├── storage.js                LocalStorage — one key per data section, with per-key backups
│   │   ├── store.js                   In-memory state; the only writer to storage.js
│   │   ├── migrations.js               Schema-version + new-collection migrations
│   │   ├── idb.js                        IndexedDB wrapper (note bodies only)
│   │   ├── router.js                      Hash-based SPA router
│   │   ├── events.js                       Tiny pub/sub event bus
│   │   └── utils.js                         Date/duration helpers, shared math
│   │
│   ├── features/                   CRUD + business logic per domain
│   │   └── subjects.js, timer.js, todos.js, notes.js, sleep.js, music.js, importExport.js
│   │
│   ├── analytics/                  Pure computation — no DOM, fully testable
│   │   ├── stats.js                  Study analytics + Dashboard snapshot
│   │   ├── insights.js                Study Smart Insights rule engine
│   │   ├── sleepStats.js               Sleep chart series + consistency math
│   │   ├── sleepInsights.js             Sleep Smart Analysis + sleep×study correlation
│   │   ├── dashboardInsight.js            Picks the single top insight for the Dashboard headline
│   │   └── charts.js                        Chart.js config builders + instance registry (anti-leak)
│   │
│   └── ui/                          DOM rendering, one file per page/component
│       ├── dashboardPage.js, timerPage.js, subjectsPage.js, analyticsPage.js,
│       │   todosPage.js, notesPage.js, sleepPage.js, musicPage.js, musicPlayer.js,
│       │   dataPage.js, settingsPage.js
│       └── modal.js, toast.js, customSelect.js, insightCards.js, emptyStates.js  (shared components)
│
└── tests/
    ├── run.mjs                     149 tests — run with `npm test`
    ├── harness.js                    Minimal describe/test/assert runner
    ├── localStorageMock.js            In-memory localStorage for Node
    └── fakeIndexedDB.js                 Minimal IndexedDB shim for Node
```

## Architecture Notes

A few decisions worth knowing about if you're extending this:

- **One LocalStorage key per data section**, not one combined blob (`studyos:subjects`, `studyos:notes`, `studyos:sleepRecords`, etc.), each with its own backup key. Editing a note never rewrites the sessions array. A backup file created on an older version of the app is migrated automatically on first load.
- **Nothing derived is ever stored.** Accuracy, streaks, consistency scores, insights — all computed fresh from raw data every time. There's no cached field that can silently drift out of sync.
- **Every insight engine has minimum-data guards.** A rule that doesn't have enough data to say something meaningful returns `null` and is simply omitted — never a fabricated or generic placeholder.
- **Chart.js instances are managed through a central registry** (`analytics/charts.js`) that destroys the previous instance before creating a new one, wired to each route's `onLeave` hook, to avoid the classic repeated-navigation memory leak.

## Running Tests

```bash
npm test
# or: node tests/run.mjs
```

149 tests, no dependencies, pure Node — covers schema validation, migrations, storage corruption/recovery, every calculation formula (timer elapsed-time math, sleep overnight-duration math, streak logic, all insight rule thresholds), and CRUD across every feature module.

## License

Add your license of choice here.
