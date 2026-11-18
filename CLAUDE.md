# Me suite

This repository (GitHub: `wastella/mesuite`, local folder `~/Developer/Me`) holds a suite of apps custom-built for William. The apps are **separate** (own code, data, build and install; none needs another to run) but **connected** (one name, one icon system, one palette, same owner and devices). `README.md` explains this for people; keep it current.

- **Me** (the repo root): the web dashboard. Everything from "Me (the dashboard)" down is about it.
- **MeReader** (`MeReader/`): native SwiftUI EPUB reader and audiobook app for iPhone and Mac (formerly Narrate). Not part of the website: it's in `.vercelignore`, has no server, and is built with Xcode. Read `MeReader/CLAUDE.md` before working in it.
- **MeMento** (`MeMento/`): reminders that flash and lock the Macs until the job is done. The folder is a small native Mac menu-bar app; the reminders themselves live in the dashboard (`lib/memento.js`, `/api/memento`, the `/memento` page and overlay, connector tools `set_reminder` / `list_reminders` / `cancel_reminder`). Read `MeMento/CLAUDE.md` before working on either half.

Suite rules:

- A new app gets a top-level folder `Me<Name>/` with its own `CLAUDE.md` and `README.md`; list it here and in the README table, and add it to `.vercelignore` unless it is part of the website.
- Icons: the Me icon's exact "Me" lettering, the app's own color, and a symbol underneath (see `MeReader/tools/make-icon.sh`). Colors so far: Me coral, MeReader blue, MeMento amber. UI uses the dashboard's dark palette with the app's color as accent.
- Apps don't read each other's files or databases. When two apps need to share something, go through the dashboard's API (or its Claude connector), and document the link in both apps.
- Work in one app shouldn't change another. Commit messages start with the app's name (`MeReader: …`, or the dashboard area such as `Calendar: …`).

# Me (the dashboard)

William's personal life dashboard: tasks, Google Calendar, notes and training. A single owner uses it on a Mac (Electron app) and an iPhone (home-screen web app). Both load the same hosted site, so data syncs through one cloud database.

## Stack

- Next.js 15 App Router, plain JavaScript (no TypeScript), React 19, custom CSS in `app/globals.css` (minimal dark theme, light variant via `prefers-color-scheme`). No Tailwind or UI library.
- Data: libSQL through `@libsql/client` (`lib/db.js`). Production uses Turso (`TURSO_DATABASE_URL`); without it, a local file at `data/me.db`. All DB access is async: `const q = await db(); await q.all/get/run(sql, ...args)`, `tx(fn)` for transactions, `kvGet`/`kvSet` for small settings. Schema is `CREATE TABLE IF NOT EXISTS` in `SCHEMA`; column additions go in `init()` as guarded `ALTER TABLE`s.
- Hosting: Vercel project `wastellas-projects/me`, production URL https://me-omega-green.vercel.app.
- Mac app: `electron/main.cjs` is a thin window onto the hosted URL (`ME_URL` overrides it). Hidden-inset title bar; the page adds `html.desktop` when the user agent contains "Electron" so the sidebar clears the window buttons.

## Layout

- `app/` pages: `/` Home (today's schedule and tasks), `/tasks`, `/calendar` (Day/Week/Month/Schedule; keys D/W/M/A, T = today, C = new event, / = search), `/notes`, `/training`, `/settings`, `/login`.
- `components/ui.js`: shared building blocks. `Sheet` (modal on a computer, drawer for task details, bottom sheet on a phone; traps focus, Esc closes), `useDialog()` for `confirm`/`prompt` (never use the browser's own `confirm()`/`prompt()`), `Popover` menus, `Segmented`, `Skeleton`, `Empty`, `LoadError`. Changes go through `attempt()` from `useApp()`, which shows an error toast and reloads if saving fails.
- `app/globals.css` is one organized stylesheet (tokens first, phone rules near the end). Reuse its classes; avoid inline styles.
- `app/api/*` route handlers wrap logic in `lib/`, using `handle`/`json`/`body` from `lib/http.js`. Client code calls them through `api()`/`useApi()` in `lib/client.js`.
- `lib/projects.js`: projects and sections (Misc can't be renamed or deleted).
- `lib/tasks.js`: tasks, quick-add (`lib/quickadd.js`, chrono-node), recurrence (`lib/dates.js`). There is no "overdue": unfinished past tasks roll to the top of today (`rollover`). Order within a day is `day_order`, changed by drag (pointer events in `components/AppProvider.js`, long-press on touch). Projects replace labels; the inbox project is called "Misc".
- `lib/google.js`: OAuth plus the full Calendar client: list/search events, one event in full (`getEvent`, with its repeat rule), create/update/delete with `scope` for repeating events (`this` | `following` | `all`; "following" splits the series), guests and RSVP (`respondToEvent`), Meet links, reminders, colours, moving between calendars, and creating/renaming/recolouring/removing calendars. `lib/rrule.js` reads, builds and describes repeat rules. Gmail helpers still exist but the Mail UI was removed on purpose.
- Calendar UI: `app/calendar/page.js` (Day/Week/Month/Schedule views, search, drag to move or resize, drag out a new slot) with `components/calendar/` (`EventForm` full editor, `EventSheet` details + RSVP, `Calendars` manager, `Scope` this/following/all dialog). The editor sends only the fields that changed. Not covered because Google's API doesn't offer them or they need Workspace: appointment schedules, out-of-office/focus time, working location, attachments, per-event time zones.
- `lib/notes.js`: notes and note categories (`category_id` NULL = Unsorted). Typing only: voice dictation was tried and removed at the owner's request, so don't add it back.
- `lib/meals.js` + `lib/ics.js`: dinners from Mealboard (the meal-planning app William's mom uses). Mealboard has no API, so it exports into an iCloud calendar that William shares as a public link (pasted into Settings → Meals, stored in kv `meals_feed`). Me reads that link (cached 10 min); it's read-only. Shown only on the Calendar tab (the owner doesn't want meals on Home), on any timed calendar event titled Supper/Dinner (`withMeals` adds `meal` in the events API and in the connector's `get_calendar`), and through the connector's `get_meals` tool.
- `lib/training.js`: upper/lower lifting split on alternating days, plus a daily posture routine. A single daily P1 "Workout" task covers lifting.
- `app/api/mcp/[token]/route.js`: the "Me" Claude connector (MCP). It exposes tools for tasks, calendar (including `delete_event`), notes, meals (read-only) and training. The URL contains the secret `MCP_TOKEN`. When you add a feature, add matching connector tools so Claude can use it from chat. Destructive tools tell Claude to confirm with the user first.
- `app/api/quick`: Siri Shortcuts endpoint (Bearer key derived from `SESSION_SECRET`). `{text}` adds a task; `{text, kind: "note"}` adds a note.
- Auth: Google sign-in limited to `OWNER_EMAIL`, with an HMAC-signed `me_session` cookie (`lib/session.js`, `middleware.js`). Public paths are listed in the middleware.
- Server "today" uses `ME_TZ` (America/New_York) via `todayStr()` and `lib/tz.js`.
- Web Push and reminder code (`lib/push.js`, `lib/reminders.js`, `/api/cron`, `scripts/github-reminders.yml`) exists but is off: the VAPID and CRON secrets were never set. The owner chose to skip notifications.

## Workflow

- Local: `npm run build && npm start` (or `npm run dev`) on http://localhost:3737. A local run uses `data/me.db`, not the real Turso data, so test there freely. The preview config is in `.claude/launch.json` (name `me`).
- Tests: `npm test` runs the logic tests in `tests/*.test.mjs` (dates, quick-add, tasks, projects, notes, meals, calendar, training, sign-in) against a throwaway database. `npm run test:e2e` builds the app and clicks through every screen at desktop and phone size with Playwright (`tests/e2e`; first time: `npx playwright install chromium`). Stop any local server on port 3737 first. Add or update tests with every change, and run both before deploying.
- `npm run seed` fills an empty local database with sample data.
- Check UI changes in the browser at desktop width and at phone width (375px), with no horizontal overflow.
- Deploy: `npx --yes vercel@65.12.1 deploy --prod --yes`.
- Mac app: `npm run install-app` rebuilds `/Applications/Me.app`. This is only needed when something in `electron/` changes, since the app loads the hosted site.
- Git: work on `main`. Commit freely, but **ask before every `git push`**. GitHub is `wastella/mesuite` (renamed from `wastella/me`). The token can't push files under `.github/workflows/`, which is why the reminders workflow sits in `scripts/`.

## Rules

- Never write secrets into Vercel, GitHub or other secret stores for the owner, and never print secrets (`MCP_TOKEN`, keys, `.env.local` values) in chat. Write a script the owner runs themselves instead (see `scripts/setup-notifications.sh`).
- `.env.local` (Google client ID and secret) and `data/` stay out of git and out of Vercel uploads (`.vercelignore`).
- Keep the UI minimal; the owner has repeatedly asked for less clutter. Remove things cleanly when asked rather than hiding them.
- Explain things to the owner in plain language: they want results, not jargon.
