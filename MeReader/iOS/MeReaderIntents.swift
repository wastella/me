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

/// Speeds you can ask Siri for: "Set MeReader speed to one point five".
enum SpeedOption: String, AppEnum {
    case x075, x1, x125, x15, x175, x2
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Speed"
    static var caseDisplayRepresentations: [SpeedOption: DisplayRepresentation] = [
        .x075: DisplayRepresentation(title: "0.75", synonyms: ["three quarters", "slow"]),
        .x1: DisplayRepresentation(title: "1", synonyms: ["one", "normal", "1x"]),
        .x125: DisplayRepresentation(title: "1.25", synonyms: ["one and a quarter", "one point two five"]),
        .x15: DisplayRepresentation(title: "1.5", synonyms: ["one and a half", "one point five"]),
        .x175: DisplayRepresentation(title: "1.75", synonyms: ["one and three quarters", "one point seven five"]),
        .x2: DisplayRepresentation(title: "2", synonyms: ["two", "double", "2x"]),
    ]
    var value: Double {
        switch self { case .x075: 0.75; case .x1: 1; case .x125: 1.25; case .x15: 1.5; case .x175: 1.75; case .x2: 2 }
    }
}

struct SetSpeedIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Set Narration Speed"
    static var description = IntentDescription("Changes how fast your book is read aloud.")
    @Parameter(title: "Speed") var speed: SpeedOption

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        AppModel.shared.narrator.rate = speed.value
        WidgetBridge.update()
        return .result(dialog: "Speed \(speed.value.formatted())")
    }
}

/// A book in your library, so Siri can say "Play Shadow Slave in MeReader".
struct BookEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Book"
    static var defaultQuery = BookQuery()
    var id: String
    var title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct BookQuery: EntityStringQuery {
    @MainActor private var all: [BookEntity] { WidgetBridge.recentBooks.map { BookEntity(id: $0.id, title: $0.title) } }
    @MainActor func entities(for identifiers: [String]) async throws -> [BookEntity] { all.filter { identifiers.contains($0.id) } }
    @MainActor func entities(matching string: String) async throws -> [BookEntity] {
        all.filter { $0.title.localizedCaseInsensitiveContains(string) }
    }
    @MainActor func suggestedEntities() async throws -> [BookEntity] { all }
}

struct PlayBookIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play Book"
    static var description = IntentDescription("Starts reading one of your books aloud from where you left off.")
    @Parameter(title: "Book") var book: BookEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        await AppModel.shared.progress.syncPositions()
        WidgetBridge.play(bookID: book.id)
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
        AppShortcut(intent: SetSpeedIntent(),
                    phrases: ["Set \(.applicationName) speed to \(\.$speed)",
                              "\(.applicationName) speed \(\.$speed)"],
                    shortTitle: "Set Speed",
                    systemImageName: "speedometer")
        AppShortcut(intent: PlayBookIntent(),
                    phrases: ["Play \(\.$book) in \(.applicationName)",
                              "Read \(\.$book) in \(.applicationName)"],
                    shortTitle: "Play Book",
                    systemImageName: "book")
        AppShortcut(intent: NextBookIntent(),
                    phrases: ["Next book in \(.applicationName)",
                              "Switch book in \(.applicationName)"],
                    shortTitle: "Next Book",
                    systemImageName: "forward.end")
        AppShortcut(intent: PauseListeningIntent(),
                    phrases: ["Pause \(.applicationName)"],
                    shortTitle: "Pause",
                    systemImageName: "pause.fill")
    }
}
