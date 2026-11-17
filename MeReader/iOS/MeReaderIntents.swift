import AppIntents

/// "Continue Listening": syncs your place from your other devices, then starts reading aloud.
/// Runs in the background (no need to open the app), which makes it the thing to trigger with a
/// Shortcuts automation: "When CarPlay connects → Continue Listening".
struct ContinueListeningIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Continue Listening"
    static var description = IntentDescription("Picks up your book where you left off, on any device, and starts reading it aloud.")

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppModel.shared.continueListening()
        return .result()
    }
}

struct PauseListeningIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Pause Listening"
    static var description = IntentDescription("Pauses narration and saves your place for your other devices.")

    @MainActor
    func perform() async throws -> some IntentResult {
        AppModel.shared.narrator.pause()
        return .result()
    }
}

struct MeReaderShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ContinueListeningIntent(),
                    phrases: ["Continue listening in \(.applicationName)",
                              "Resume my book in \(.applicationName)",
                              "Play my book in \(.applicationName)",
                              "\(.applicationName) continue"],
                    shortTitle: "Continue Listening",
                    systemImageName: "headphones")
        AppShortcut(intent: PauseListeningIntent(),
                    phrases: ["Pause \(.applicationName)"],
                    shortTitle: "Pause",
                    systemImageName: "pause.fill")
    }
}
