import Foundation
import UIKit
import Combine
import WidgetKit

/// App side of the widget: keeps the shared snapshot current and performs the widget's button.
@MainActor
enum WidgetBridge {
    private static var bag: Set<AnyCancellable> = []
    private static var last: WidgetSnapshot?
    private static var lastCoverBook: String?
    private static var started = false

    /// Called once at launch.
    static func start() {
        guard !started else { return }
        started = true
        let app = AppModel.shared
        app.narrator.$isPlaying.removeDuplicates().sink { _ in schedule() }.store(in: &bag)
        app.narrator.$book.map { $0?.id }.removeDuplicates().sink { _ in schedule() }.store(in: &bag)
        app.narrator.$position.map(\.chapter).removeDuplicates().sink { _ in schedule() }.store(in: &bag)
        app.library.$books.map(\.count).removeDuplicates().sink { _ in
            schedule()
            MeReaderShortcuts.updateAppShortcutParameters()   // so Siri knows the book titles
        }.store(in: &bag)
        app.narrator.$rate.removeDuplicates().sink { _ in schedule() }.store(in: &bag)
        schedule()
    }

    static func toggle() async {
        start()   // the widget's button can launch the app in the background, with no window
        let app = AppModel.shared
        if app.narrator.isPlaying { app.narrator.pause() } else { await app.continueListening() }
        update()
    }

    /// Speeds the widget and Siri step through (the same list as the in-app menu).
    static let speeds: [Double] = [0.75, 1.0, 1.1, 1.25, 1.4, 1.5, 1.75, 2.0, 2.5]

    static func stepSpeed(_ direction: Int) {
        start()
        let n = AppModel.shared.narrator
        let i = speeds.enumerated().min { abs($0.element - n.rate) < abs($1.element - n.rate) }?.offset ?? 1
        n.rate = speeds[min(speeds.count - 1, max(0, i + direction))]
        update()
    }

    /// Your books, most recently used first.
    static var recentBooks: [Book] {
        let app = AppModel.shared
        func touched(_ b: Book) -> Date { app.progress.records[b.id]?.updatedAt ?? b.addedAt }
        return app.library.books.sorted { touched($0) > touched($1) }
    }

    /// The book "next book" switches to: the one after the current book in most-recent order.
    /// Fixed for the session once you start switching, so repeated presses cycle through all of them.
    private static var cycle: [String] = []
    static func bookAfterCurrent() -> Book? {
        let app = AppModel.shared
        let books = recentBooks
        guard books.count > 1, let current = app.narrator.book ?? app.mostRecentBook else { return nil }
        if Set(cycle) != Set(books.map(\.id)) { cycle = books.map(\.id) }
        guard let i = cycle.firstIndex(of: current.id) else { return books.first { $0.id != current.id } }
        return app.library.book(id: cycle[(i + 1) % cycle.count])
    }

    static func nextBook() {
        start()
        guard let book = bookAfterCurrent() else { return }
        AppModel.shared.narrator.play(book)
        update()
    }

    static func play(bookID: String) {
        start()
        guard let book = AppModel.shared.library.book(id: bookID) else { return }
        AppModel.shared.narrator.play(book)
        update()
    }

    private static func schedule() { DispatchQueue.main.async { update() } }

    static func update() {
        let app = AppModel.shared
        guard let book = app.narrator.book ?? app.mostRecentBook else {
            if last != nil { last = nil; UserDefaults(suiteName: WidgetSnapshot.group)?.removeObject(forKey: "widgetSnapshot"); WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.kind) }
            return
        }
        let chapter = app.narrator.book?.id == book.id ? app.narrator.position.chapter : app.progress.position(for: book.id).chapter
        let snap = WidgetSnapshot(bookTitle: book.title,
                                  chapterTitle: book.chapters[safe: chapter]?.title ?? "",
                                  detail: "Chapter \((chapter + 1).formatted()) of \(book.chapters.count.formatted())",
                                  isPlaying: app.narrator.isPlaying && app.narrator.book?.id == book.id,
                                  rate: app.narrator.rate,
                                  nextBookTitle: bookAfterCurrent()?.title)
        if lastCoverBook != book.id, let dest = WidgetSnapshot.coverURL {
            lastCoverBook = book.id
            try? FileManager.default.removeItem(at: dest)
            // A small copy of the cover: widgets have a tight memory limit.
            if let url = app.library.coverURL(book), let img = UIImage(contentsOfFile: url.path) {
                let h: CGFloat = 300, size = CGSize(width: h * img.size.width / max(1, img.size.height), height: h)
                let small = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
                try? small.jpegData(compressionQuality: 0.8)?.write(to: dest)
            }
        }
        guard snap != last else { return }
        last = snap
        snap.save()
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.kind)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.controlsKind)
    }
}
