# Me suite

A set of apps custom-built for one person. Each app does one job and stands on its own: its own code, its own data, its own install. They are made to be used together, share one look and one name, and live in this one repository.

## The apps

| App | What it does | Runs on | Folder | Color |
|---|---|---|---|---|
| **Me** | Dashboard: tasks, Google Calendar, notes, training | Web, iPhone home screen, Mac | repo root | Coral |
| **MeReader** | Reads any EPUB and turns it into an audiobook, with one shared place | iPhone, Mac | [`MeReader/`](MeReader/) | Blue |
| **MeMento** | Reminders that flash and lock your screens until you’ve done the thing | Mac (menu bar), iPhone through Me | [`MeMento/`](MeMento/) | Amber |

## Separate

- **Own code:** every app after the dashboard has its own top-level folder, `Me<Name>/`, with its own `README.md` and `CLAUDE.md`. The dashboard is the exception: it stays at the repo root because that is what the website deploys from.
- **Own data:** Me keeps its data in a cloud database. MeReader keeps books and your place on the device and in iCloud Drive. Neither needs the other to work.
- **Own build:** Me is a Next.js site deployed to Vercel (other apps are excluded in `.vercelignore`). MeReader is a SwiftUI app built with Xcode.

## Connected

- **One identity:** every icon is the same "Me" lettering in the same place, with the app's own color and a symbol underneath (a book for MeReader, a bell for MeMento). The apps use the same dark palette; only the accent color differs.
- **One owner, both devices:** each app syncs between the Mac and the iPhone.
- **One way in for Claude:** the Me dashboard has a Claude connector, so tasks, calendar, notes and training can be read and changed from a chat.
- **Not yet:** the apps don't read each other's data. Links between them (for example a task that opens a book, or listening time showing up on the dashboard) are the next step, and should go through the dashboard's API rather than shared files.

## Adding an app

1. Create `Me<Name>/` with a `README.md` and a `CLAUDE.md`.
2. Add it to the table above, to the list in the root `CLAUDE.md`, and to `.vercelignore` (unless it is part of the website).
3. Make its icon from the Me icon, with its own color and symbol (see `MeReader/tools/make-icon.sh`), and use the shared palette with that color as the accent.

---

## Me (the dashboard)

Your personal dashboard: tasks, Google Calendar, notes and training, in sync between your Mac and iPhone.


- **Web/phone:** https://me-omega-green.vercel.app. On iPhone, open it in Safari, then **Share → Add to Home Screen**.
- **Mac:** the Me app in Applications is a native window onto the same site.
- **Data:** your own Turso database (`me`). Only `OWNER_EMAIL` can sign in, with Google.

### Deploying changes

```bash
cd ~/Developer/Me && npx --yes vercel@65.12.1 deploy --prod --yes
```

Settings (Turso URL and token, `SESSION_SECRET`, `OWNER_EMAIL`, `APP_URL`, `ME_TZ`) live in the Vercel project. To rebuild the Mac app after changing `electron/`, run `npm run install-app`.

### Local development

`npm run dev` runs Me at http://localhost:3737 against a local SQLite file in `data/`, with no sign-in. To point the Mac app at it, use `npm run app:local`.

### Connect Google (one time, about 5 minutes)

Detailed steps are in the app under **Settings**. In short:

1. In Google Cloud, create a project named **Me** and enable the **Google Calendar API** and the **Gmail API**.
2. In **Google Auth Platform**, choose **Get started**. Set the audience to External, then **Publish app**. If you leave it in Testing, Google signs you out every 7 days.
3. Under **Clients**, choose **Create client** with type **Web application**, and set the redirect URI to `http://localhost:3737/api/google/callback`.
4. Paste the client ID and secret into **Settings** and click **Save**.
5. Click **Connect Google**. Sign-in opens in your normal browser, because Google doesn't allow it inside apps. When Google warns the app is unverified, choose **Advanced → Go to Me**, approve, then switch back to Me.

Permissions requested: calendar read/write, and Gmail read, label and archive. Me can't send or delete email.

### Todoist

Everything was imported from Todoist on 2026-11-04 (projects, recurring rules and two years of completed history). Labels were merged into projects, and Inbox became **Misc**.

### Quick add

Press **Q** anywhere. For example: `Call mom tomorrow 5pm p1 #Misc`, or `Stretch every day at 7am`, or `Pay rent every 1st`, or `Haircut every! 6 weeks` (the `!` repeats from the day you complete it).

### Tests

- `npm test` checks the logic (dates, repeats, quick add, tasks, projects, notes, training, sign-in) against a throwaway database.
- `npm run test:e2e` builds the app and clicks through every screen at desktop and phone size. First time only: `npx playwright install chromium`. Stop any local server on port 3737 first.
- `npm run seed` fills an empty local database with sample data to look at.
