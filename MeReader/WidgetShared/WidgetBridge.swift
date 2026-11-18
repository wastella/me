import Foundation
import AppIntents
import WidgetKit

/// What the home-screen / CarPlay widget shows. The app writes it into the shared App Group;
/// the widget only reads it. Compiled into both the app and the widget extension.
struct WidgetSnapshot: Codable, Equatable {
    var bookTitle: String
    var chapterTitle: String
    var detail: String          // e.g. "Chapter 1,687 of 2,716"
    var isPlaying: Bool

    static let group = "group.idk.Narrate"
    static let kind = "MeReaderWidget"
    private static let key = "widgetSnapshot"

    static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    static var coverURL: URL? { container?.appendingPathComponent("widget-cover.jpg") }

    static func load() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.group)?.set(data, forKey: Self.key)
    }
}

/// The widget's button. An audio intent runs inside the app (started in the background if
/// needed), so it works from the Home Screen, the Lock Screen and the CarPlay widget screen.
struct TogglePlaybackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play or Pause"
    static var description = IntentDescription("Continues your book where you left off, or pauses it.")

    func perform() async throws -> some IntentResult {
        #if !WIDGET_EXTENSION
        await WidgetBridge.toggle()
        #endif
        return .result()
    }
}
