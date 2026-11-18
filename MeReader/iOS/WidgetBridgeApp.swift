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
        app.library.$books.map(\.count).removeDuplicates().sink { _ in schedule() }.store(in: &bag)
        schedule()
    }

    static func toggle() async {
        start()   // the widget's button can launch the app in the background, with no window
        let app = AppModel.shared
        if app.narrator.isPlaying { app.narrator.pause() } else { await app.continueListening() }
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
                                  isPlaying: app.narrator.isPlaying && app.narrator.book?.id == book.id)
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
    }
}
