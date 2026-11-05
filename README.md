# Me

Your personal dashboard: tasks (migrated from Todoist), Google Calendar and Gmail, all in one place. Runs only on this Mac at <http://localhost:3737>. Your data lives in `data/me.db`.

## Run it

Double-click **Start Me.command**, or:

```bash
cd ~/Me && npm start
```

After you change the code, run `npm run build` once, then start again. For live-reload while you're editing, use `npm run dev` instead.

Tip: in Chrome, open the app and choose **⋮ → Cast, save and share → Install page as app**. That gives Me its own Dock icon and window.

## Connect Google (one time, about 5 minutes)

Detailed steps are in the app under **Settings**. In short:

1. In Google Cloud, create a project named **Me** and enable the **Google Calendar API** and the **Gmail API**.
2. In **Google Auth Platform**, choose **Get started**. Set the audience to External, then **Publish app**. If you leave it in Testing, Google signs you out every 7 days.
3. Under **Clients**, choose **Create client** with type **Web application**, and set the redirect URI to `http://localhost:3737/api/google/callback`.
4. Paste the client ID and secret into `.env.local` as `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=`. You don't need to restart the app.
5. In Settings, click **Connect Google**. When Google warns the app is unverified, choose **Advanced → Go to Me**.

Permissions requested: calendar read/write, and Gmail read, label and archive. Me can't send or delete email.

## Todoist

Everything was imported on 2026-11-04: projects, sections, labels, open tasks, recurring rules and two years of completed history. You can run **Settings → Re-import** (or `npm run import:todoist`) again at any time. It updates the imported tasks rather than duplicating them. Once you've moved over, it's best to stop adding tasks in Todoist.

## Quick add

Press **Q** anywhere. For example: `Call mom tomorrow 5pm p1 #Inbox @phone`, or `Stretch every day at 7am`, or `Pay rent every 1st`, or `Haircut every! 6 weeks` (the `!` repeats from the day you complete it).
