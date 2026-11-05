# Me

Your personal dashboard: tasks (migrated from Todoist), Google Calendar and Gmail, all in one place. Me is a native macOS app (Electron). Your data lives in `~/Library/Application Support/Me` and never leaves your Mac.

## Run it

Open **Me** from Applications, Launchpad or Spotlight. To keep it handy, right-click its Dock icon and choose **Options → Keep in Dock**. To have it start when you log in, choose **Me → Open at Login** in the menu bar.

Shortcuts: **⌘N** quick-adds a task, **⌘1–4** switch between Today, Tasks, Calendar and Mail, and **⌘,** opens Settings. Closing the window keeps Me running in the Dock; use **⌘Q** to quit. The Dock badge shows how many tasks are due or overdue.

### Rebuilding after code changes

```bash
cd ~/Me && npm run install-app
```

This builds the app and replaces `/Applications/Me.app`. Quit Me first.

To develop with live-reload in a browser, use `npm run dev` and open http://localhost:3737. That mode uses `~/Me/data` instead of the desktop app's data.

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
