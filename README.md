# Me

Your personal dashboard: tasks, Google Calendar, Gmail and training, in sync between your Mac and iPhone.

- **Web/phone:** https://me-omega-green.vercel.app. On iPhone, open it in Safari, then **Share → Add to Home Screen**.
- **Mac:** the Me app in Applications is a native window onto the same site.
- **Data:** your own Turso database (`me`). Only `OWNER_EMAIL` can sign in, with Google.

## Deploying changes

```bash
cd ~/Me && npx vercel deploy --prod
```

Settings (Turso URL and token, `SESSION_SECRET`, `OWNER_EMAIL`, `APP_URL`, `ME_TZ`) live in the Vercel project. To rebuild the Mac app after changing `electron/`, run `npm run install-app`.

## Local development

`npm run dev` runs Me at http://localhost:3737 against a local SQLite file in `data/`, with no sign-in. To point the Mac app at it, use `npm run app:local`.

## Connect Google (one time, about 5 minutes)

Detailed steps are in the app under **Settings**. In short:

1. In Google Cloud, create a project named **Me** and enable the **Google Calendar API** and the **Gmail API**.
2. In **Google Auth Platform**, choose **Get started**. Set the audience to External, then **Publish app**. If you leave it in Testing, Google signs you out every 7 days.
3. Under **Clients**, choose **Create client** with type **Web application**, and set the redirect URI to `http://localhost:3737/api/google/callback`.
4. Paste the client ID and secret into **Settings** and click **Save**.
5. Click **Connect Google**. Sign-in opens in your normal browser, because Google doesn't allow it inside apps. When Google warns the app is unverified, choose **Advanced → Go to Me**, approve, then switch back to Me.

Permissions requested: calendar read/write, and Gmail read, label and archive. Me can't send or delete email.

## Todoist

Everything was imported from Todoist on 2026-11-04 (projects, recurring rules and two years of completed history). Labels were merged into projects, and Inbox became **Misc**.

## Quick add

Press **Q** anywhere. For example: `Call mom tomorrow 5pm p1 #Misc`, or `Stretch every day at 7am`, or `Pay rent every 1st`, or `Haircut every! 6 weeks` (the `!` repeats from the day you complete it).
