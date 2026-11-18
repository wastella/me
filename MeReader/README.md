# MeReader

One of the [Me suite](../README.md) apps: separate from the Me dashboard, with the same look.

Read any EPUB, or have it read aloud, with one shared bookmark. Pause the audio and the text is
sitting on the word you heard last. Scroll ahead while reading, press play, and it starts from there.

- **iPhone + Mac** (SwiftUI). `MeReader` = iOS target, `MeReaderMac` = macOS target.
- **Audiobook generated on the fly** with Apple's on-device voices (free, offline). Words are
  highlighted as they're spoken. Download a *Premium* voice for a far more natural narrator
  (iOS: Settings → Accessibility → Read & Speak → Voices; the MeReader Settings screen explains).
- **In the car:** lock screen / CarPlay Now Playing / steering-wheel controls (±15 s, next/previous
  chapter, speed), sleep timer, pauses when the car disconnects.
- **Sync between devices** through `iCloud Drive/Narrate` (progress + shared books). The Mac uses it
  automatically; on the iPhone pick that folder once in Settings.

## Install
- Mac: already in `/Applications/MeReader.app`.
- iPhone: `./install-iphone.sh` (cable or same Wi‑Fi). Free developer installs expire after 7 days;
  `./install-auto-reinstall.sh` adds a launchd job that reinstalls over Wi‑Fi every 4 days
  (log: `~/Library/Logs/MeReader-reinstall.log`). The app also warns you in its last 2 days.

## In the car
MeReader never starts by itself on connect (it ignores the automatic "play" many cars send in the
first seconds). Press play on the phone, in CarPlay Now Playing, or on the steering wheel: it syncs
your place first (≤3 s), even if the app had been closed. "Hey Siri, continue listening in MeReader"
does the same. After a pause of more than 5 s it resumes from the start of the sentence.

## Kokoro voice (prepared on the Mac)
The iPhone can't run a neural voice with the screen off, so the Mac does it ahead of time:
- MeReader lives in the menu bar on the Mac (waveform icon). At login it starts there with no window and no Dock icon; the Dock icon only shows while the library window is open. Closing the window keeps it running; use Quit in the menu bar panel to stop it.
- While the Mac is on, `macOS/AudioRenderer.swift` renders the next chapters of your 3 most recent books with Kokoro, starting at your current place (chapter 1 for a new book), until 6 hours are ready (Settings: 2–24 h). Chapters you've finished are deleted.
- Files go to iCloud Drive › Narrate › Audio/<bookID>/<chapter>.m4a + .json (word timings).
- The iPhone copies upcoming chapters into its own storage on every sync, then plays them with highlighting. Anything not prepared falls back to the system voice.
- Turn off per device in Settings → Kokoro voice.

## What isn't read aloud
`Shared/EPUB/SpeechFilter.swift` mutes the repeated chapter title, scraper watermarks
(incl. homoglyph domains and `<.com>`), and author/translator notes. Muted paragraphs stay on
screen (dimmed) so saved positions never shift.

## CarPlay
MeReader plays through CarPlay's built-in **Now Playing** screen today. The dashboard app (tap
"Continue" → sync → play) is written and runs in the simulator's CarPlay screen. Showing up as its own icon
on the CarPlay home screen requires Apple's CarPlay audio entitlement (paid developer account +
request at developer.apple.com/carplay). The code for that (`iOS/CarPlaySceneDelegate.swift`) is
already written: once granted, add `com.apple.developer.carplay-audio` to a device entitlements file.

## Layout
- `Shared/EPUB` — tolerant EPUB/HTML parsing (zip or Apple Books folder-style EPUBs)
- `Shared/Audio/Narrator.swift` — TTS → audio engine pipeline, word timing, Now Playing
- `Shared/Sync/ProgressStore.swift` — local + iCloud Drive folder sync
- `Shared/Views` — library, reader, mini player, Now Playing, settings
