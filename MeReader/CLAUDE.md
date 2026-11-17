# Narrate

William's EPUB reader and on-the-fly audiobook app for iPhone and Mac (SwiftUI). One shared bookmark: pause the audio and the text is on the last word heard; scroll ahead and press play to start from there. README.md describes the features in detail; read it first.

## Project

- `project.yml` is the source of truth (XcodeGen). `Narrate.xcodeproj` is generated: after adding or removing files or changing targets, settings or packages, run `xcodegen generate` instead of editing the `.pbxproj`.
- Targets: `Narrate` (iOS 18+, bundle ID `idk.Narrate`) and `NarrateMac` (macOS 15+, product name `Narrate`, bundle ID `idk.Narrate.mac`). Signing is automatic with team `QM2CU9BH99`, which is a free Apple developer account.
- Packages: ZIPFoundation (both targets), plus KokoroSwift, MLXUtilsLibrary and mlx-swift on the Mac only.

## Layout

- `Shared/EPUB`: tolerant EPUB/HTML parsing (zipped, or Apple Books folder-style). `SpeechFilter.swift` mutes repeated chapter titles, scraper watermarks and author notes; muted text stays on screen, dimmed, so saved positions never shift.
- `Shared/Audio/Narrator.swift`: text-to-speech into the audio engine, word timing and highlighting, Now Playing and remote controls. `RenderedAudio.swift` plays chapters the Mac pre-rendered with Kokoro, falling back to Apple's voices.
- `Shared/Sync/ProgressStore.swift`: progress and shared books, stored locally and in `iCloud Drive/Narrate`. There is no server.
- `Shared/Views`: library, reader, mini player, Now Playing, settings, theme.
- `iOS/`: CarPlay scene (it needs Apple's CarPlay audio entitlement, which isn't granted yet), Siri/App Intents ("continue listening in Narrate"), and `AppExpiry.swift` (warns before the 7-day free-signing expiry).
- `macOS/`: menu bar app (no Dock icon unless the library window is open), and `KokoroEngine` + `AudioRenderer`. These render upcoming chapters of the 3 most recent books to `iCloud Drive/Narrate/Audio/<bookID>/<chapter>.m4a` + `.json` word timings. The 327 MB Kokoro model is downloaded from Hugging Face into Application Support on first use and is not in the repo. `Resources/kokoro-voices.npz` is.

## Car behavior (deliberate; keep it)

Narrate never auto-plays when a car connects: it ignores the automatic "play" cars send in the first seconds. On play it syncs your place first (≤3 s). After a pause longer than 5 s it resumes from the start of the sentence.

## Build and install

- Mac: build `NarrateMac` (Release) and copy `Narrate.app` into `/Applications`.
- iPhone: `./install-iphone.sh` (cable or same Wi-Fi). Free installs expire after 7 days. `./install-auto-reinstall.sh` adds a launchd job (`com.narrate.reinstall`) that reinstalls every 4 days; log at `~/Library/Logs/Narrate-reinstall.log`. Only one Mac should run that job.
- Build output goes to `/Volumes/T7/NarrateBuild` when that external SSD is plugged in (the MacBook's internal disk is nearly full), otherwise to `build/`.
- Use the iOS Simulator to check UI changes when possible.

## Rules

- Git: commit freely, but ask before every `git push`.
- Never print or store secrets. The app has no API keys; keep it that way unless the owner asks.
- Explain things in plain language: the owner wants results, not jargon. Keep the UI minimal.
