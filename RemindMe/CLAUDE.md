# RemindMe

Part of the Me suite (see the root `CLAUDE.md`). RemindMe is William's reminder that can't be ignored: he asks Claude to remind him of something, and when it goes off his Macs lock on the reminder for as long as the job takes ("go move the laundry": about 4 minutes), then ask whether he did it. Accent colour: amber.

Naming: the app was first called MeMento. Everything William sees says RemindMe (the one suite app whose name ends in "Me" rather than starting with it; his choice). Inside the dashboard the old word remains on purpose, so the key and stored reminders carry over: table `mementos`, `lib/memento.js`, `/api/memento`, `components/Memento.js`, CSS classes `.memento-*`, and the key's purpose string `memento`. Don't rename those.

## Pieces

- **Reminders live in the dashboard**, not here: table `mementos`, logic in `/lib/memento.js`, routes `/app/api/memento` (signed-in web app) and `/app/api/memento/device` (this Mac app; Bearer key derived from `SESSION_SECRET`, shown in Me → Settings → RemindMe). The server's clock decides when a reminder fires and when its lock ends, so every device agrees.
- **Claude** sets them with the dashboard connector's `set_reminder` tool and chooses `lock_minutes` itself (guidance is in the tool description). Also `list_reminders`, `cancel_reminder`.
- **This folder is the Mac app**: one Swift file (`Sources/main.swift`, AppKit + SwiftUI), built with `swiftc` by `build.sh`. No Xcode project. It's a menu-bar app (bell icon, no Dock icon) with one small window (status, upcoming reminders, Test Lock, Set Key, Open at Login) that appears whenever William opens the app, because the bell can be hidden behind the MacBook's notch. It asks the dashboard every 10 seconds, and at the moment the next reminder is due, what should be on screen.
- **The phone** has no app here: the dashboard's web app shows the same takeover (`/components/Memento.js`, page `/remindme`) and gets a web push when one fires, if notifications are set up. iOS doesn't let apps lock the phone, so the hard lock is Mac-only.

- **Seeing that devices are in sync:** each Mac sends its name when it checks in (`X-Device`), the dashboard keeps the last time it heard from each (kv `memento_devices`), and the app's window lists them. The window's test button fires a real 15-second reminder on every device (`source: 'test'`, kept out of history).

## Behaviour to keep

- While locked, the Mac shows the reminder on every display above everything, with the Dock, menu bar, app switching, Force Quit and log-out turned off (`NSApp.presentationOptions`). Quit is refused too.
- It always lets go: when the server's lock time passes; never after more than an hour (`maxLock`, and `MAX_LOCK` on the server); and through the emergency exit (typing "I am skipping this reminder"), which is recorded as `skipped` so Claude can see it. Don't remove these.
- No flashing, ever: William asked for it to be removed over health concerns. The reminder fades in once with a single chime.
- After the lock: **Done**, or **Not yet** (comes back in 10 minutes and locks again). Unanswered for 12 hours = `missed`.
- A reminder can be cancelled only before it fires.

## Build and test

- `./build.sh` builds `build/RemindMe.app`; `./build.sh install` also copies it to `/Applications` and starts it. First run asks for the key. Do this on each Mac (MacBook Air and Mac mini).
- `tools/make-icon.sh` redraws the icon from the Me icon.
- Test without the server: `build/RemindMe.app/Contents/MacOS/RemindMe --demo 8` (a real 8-second lock), add `--windowed` for an ordinary window, and `--snapshot /tmp/shot` to save pictures of each stage. `--verbose` prints what it's doing; `--home-snapshot /tmp/home.png` saves a picture of the window. `REMINDME_URL` / `REMINDME_KEY` point it at another server.
- The key and server address are stored in `~/Library/Application Support/RemindMe/config.json` (readable only by the user). Never print the key.
- A real lock takes over the whole Mac: warn William before running one, and keep test locks to a few seconds.
