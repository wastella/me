import Foundation
import SwiftUI
import Combine

/// Wires the library, progress store and narrator together. One instance shared by the
/// phone/Mac UI and the CarPlay scene.
@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    let library = Library()
    let progress = ProgressStore()
    let narrator = Narrator()
    @Published var errorMessage: String?
    @Published var isSyncing = false

    private var importedSharedNames: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "importedShared") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "importedShared") }
    }

    private var bag: Set<AnyCancellable> = []

    private init() {
        narrator.attach(library: library, progress: progress)
        // Pausing (turning off the car, closing the laptop) is when the other device needs our place.
        narrator.$isPlaying.removeDuplicates().dropFirst().filter { !$0 }
            .sink { [weak self] _ in
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    await self?.syncNow()
                }
            }
            .store(in: &bag)
        narrator.remotePlayHandler = { [weak self] in Task { await self?.continueListening() } }
        #if os(iOS)
        // Have the most recent book ready, so Play on the steering wheel works right after launch.
        if let book = mostRecentBook { narrator.prepare(book) }
        #endif
        // Re-publish sync changes so views reading `syncState` update.
        progress.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
        #if os(macOS)
        progress.sync.configureDefaultIfNeeded()
        #endif
    }

    /// Books already present in the shared folder (uploaded from here, or downloaded from it).
    private var sharedBookIDs: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "sharedBookIDs") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "sharedBookIDs") }
    }

    func importFiles(_ urls: [URL]) async {
        for url in urls {
            do {
                try await library.importEPUB(from: url)
            } catch {
                errorMessage = "Couldn't import \(url.lastPathComponent): \(error.localizedDescription)"
            }
        }
        await syncNow()
    }

    /// Two-way sync: positions both ways, books both ways. Safe to call often; every run
    /// retries whatever failed last time.
    func syncNow() async {
        guard progress.sync.isConfigured, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        let changed = await progress.syncPositions()
        if let book = narrator.book, changed.contains(book.id), !narrator.isPlaying {
            narrator.readerMoved(to: progress.position(for: book.id), in: book)
        }

        // Download books other devices added.
        let shared = await progress.sync.sharedBooks()
        let sharedNames = Set(shared.map(\.lastPathComponent))
        for url in shared where !importedSharedNames.contains(url.lastPathComponent) {
            do {
                let book = try await library.importEPUB(from: url)
                importedSharedNames.insert(url.lastPathComponent)
                sharedBookIDs.insert(book.id)
            } catch {
                // Probably still downloading from iCloud; try again next sync.
            }
        }

        // Upload books this device has that the folder doesn't.
        var uploadError: String?
        for book in library.books where !sharedBookIDs.contains(book.id) {
            let name = Self.fileName(for: book)
            if sharedNames.contains(name) { sharedBookIDs.insert(book.id); continue }
            guard let file = await library.epubFile(for: book) else { continue }
            progress.syncStatus = "Uploading \(book.title)…"
            if let e = await progress.sync.shareBook(file, as: name) {
                uploadError = e
            } else {
                sharedBookIDs.insert(book.id)
                importedSharedNames.insert(name)
            }
        }
        if let uploadError { progress.syncError = uploadError }

        #if os(macOS)
        AudioRenderer.shared.poke()   // your place may have moved: prepare the chapters ahead of it
        #else
        await fetchPreparedAudio()
        #endif
        if progress.syncStatus?.hasPrefix("Uploading") == true {
            progress.syncStatus = "Last synced \(Date().formatted(date: .omitted, time: .shortened))"
        }
    }

    #if os(iOS)
    /// Chapters of prepared (Kokoro) audio stored on this iPhone, ahead of your place.
    @Published private(set) var preparedChapters: [String: Int] = [:]

    /// Copies the audio your Mac prepared for your current book onto the phone, ahead of time,
    /// so it plays in the car without a connection.
    private func fetchPreparedAudio() async {
        guard RenderedAudio.enabled else { return }
        let books = [mostRecentBook, narrator.book].compactMap { $0 }
        var seen = Set<String>()
        for book in books where seen.insert(book.id).inserted {
            let pos = progress.position(for: book.id).chapter
            let range = max(0, pos - 1)..<min(book.chapters.count, pos + 60)
            let have = await progress.sync.fetchAudio(bookID: book.id, chapters: range,
                                                      into: RenderedAudio.directory(bookID: book.id))
            preparedChapters[book.id] = have
        }
    }
    #endif

    static func fileName(for book: Book) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        let clean = book.title.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return (clean.isEmpty ? book.id : clean) + ".epub"
    }

    /// The book you touched last, on any device.
    var mostRecentBook: Book? {
        library.books.max {
            (progress.records[$0.id]?.updatedAt ?? $0.addedAt) < (progress.records[$1.id]?.updatedAt ?? $1.addedAt)
        }
    }

    private var continuing = false

    /// "Get in the car" entry point (Siri, Shortcuts automation, CarPlay, steering wheel):
    /// grabs the latest position from your other devices (waiting at most ~3 s), then plays.
    func continueListening() async {
        guard !continuing else { return }
        continuing = true
        defer { continuing = false }
        if progress.sync.isConfigured {
            let pull = Task { await progress.syncPositions() }
            let deadline = Date().addingTimeInterval(3)
            while Date() < deadline {
                if progress.lastSyncedAt.map({ Date().timeIntervalSince($0) < 4 }) == true && !pull.isCancelled { break }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        guard let book = (narrator.isPlaying ? narrator.book : nil) ?? mostRecentBook ?? narrator.book else { return }
        if narrator.isPlaying && narrator.book?.id == book.id { return }
        narrator.play(book)
        Task { await syncNow() }   // books etc. in the background
    }

    func delete(_ book: Book) {
        if narrator.book?.id == book.id { narrator.stop() }
        library.delete(book)
    }

    func chapterProgressText(_ book: Book) -> String {
        let p = progress.position(for: book.id)
        guard progress.records[book.id] != nil else { return "Not started" }
        let pct = Int((Double(p.chapter) / Double(max(1, book.chapters.count)) * 100).rounded())
        return "Chapter \(p.chapter + 1) of \(book.chapters.count) · \(pct)%"
    }
}
