import Foundation
import ZIPFoundation

/// Owns the books on this device and parses chapters on demand.
@MainActor
final class Library: ObservableObject {
    @Published private(set) var books: [Book] = []
    @Published var importStatus: String?

    let root: URL
    private var chapterCache: [String: [Block]] = [:]
    private var cacheOrder: [String] = []

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = support.appendingPathComponent("Narrate/Books", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        var loaded: [Book] = []
        for dir in dirs {
            if let data = try? Data(contentsOf: dir.appendingPathComponent("meta.json")),
               let book = try? JSONDecoder().decode(Book.self, from: data) {
                loaded.append(book)
            }
        }
        books = loaded.sorted { $0.addedAt > $1.addedAt }
    }

    func book(id: String) -> Book? { books.first { $0.id == id } }

    func contentRoot(_ book: Book) -> URL { root.appendingPathComponent(book.id).appendingPathComponent("content") }

    func coverURL(_ book: Book) -> URL? {
        book.coverPath.map { contentRoot(book).appendingPathComponent($0) }
    }

    func fileURL(_ book: Book, path: String) -> URL { contentRoot(book).appendingPathComponent(path) }

    // MARK: Chapters

    func blocks(_ book: Book, chapter: Int) -> [Block] {
        guard book.chapters.indices.contains(chapter) else { return [] }
        let key = "\(book.id)#\(chapter)"
        if let cached = chapterCache[key] { return cached }
        let ref = book.chapters[chapter]
        let data = (try? Data(contentsOf: contentRoot(book).appendingPathComponent(ref.path))) ?? Data()
        var blocks = SpeechFilter.apply(ChapterParser.parse(data, chapterPath: ref.path), chapterTitle: ref.title)
        if blocks.isEmpty { blocks = [Block(kind: .paragraph, text: " ")] }
        chapterCache[key] = blocks
        cacheOrder.append(key)
        if cacheOrder.count > 24 { chapterCache[cacheOrder.removeFirst()] = nil }
        return blocks
    }

    // MARK: Import

    /// Imports an .epub file (zip) or an exploded .epub folder (as Apple Books stores them).
    /// Returns the imported (or already-present) book.
    @discardableResult
    func importEPUB(from source: URL) async throws -> Book {
        importStatus = "Importing \(source.deletingPathExtension().lastPathComponent)…"
        defer { importStatus = nil }
        let root = self.root
        let book = try await Task.detached(priority: .userInitiated) { () throws -> Book in
            let fm = FileManager.default
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }

            let staging = root.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
            let content = staging.appendingPathComponent("content", isDirectory: true)
            try fm.createDirectory(at: staging, withIntermediateDirectories: true)
            do {
                var coordError: NSError?
                var innerError: Error?
                NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordError) { url in
                    do {
                        var isDir: ObjCBool = false
                        fm.fileExists(atPath: url.path, isDirectory: &isDir)
                        if isDir.boolValue {
                            try fm.copyItem(at: url, to: content)
                        } else {
                            try fm.createDirectory(at: content, withIntermediateDirectories: true)
                            try fm.unzipItem(at: url, to: content)
                            // Keep the original so it can be shared to other devices later.
                            try? fm.copyItem(at: url, to: staging.appendingPathComponent("original.epub"))
                        }
                    } catch { innerError = error }
                }
                if let e = coordError ?? innerError { throw e }

                let parsed = try EPUBParser.parse(root: content)
                let id = EPUBParser.bookID(identifier: parsed.identifier, title: parsed.title, author: parsed.author)
                let final = root.appendingPathComponent(id, isDirectory: true)
                if fm.fileExists(atPath: final.appendingPathComponent("meta.json").path),
                   let data = try? Data(contentsOf: final.appendingPathComponent("meta.json")),
                   let existing = try? JSONDecoder().decode(Book.self, from: data) {
                    try? fm.removeItem(at: staging)
                    return existing
                }
                let book = Book(id: id, title: parsed.title, author: parsed.author, chapters: parsed.chapters,
                                coverPath: parsed.coverPath, addedAt: Date())
                try JSONEncoder().encode(book).write(to: staging.appendingPathComponent("meta.json"))
                try? fm.removeItem(at: final)
                try fm.moveItem(at: staging, to: final)
                return book
            } catch {
                try? fm.removeItem(at: staging)
                throw error
            }
        }.value
        reload()
        return book
    }

    /// An .epub file for this book, suitable for copying to another device. Uses the original
    /// file when we kept it, otherwise zips the extracted contents once (folder-style EPUBs,
    /// or books imported before originals were kept).
    func epubFile(for book: Book) async -> URL? {
        let dir = root.appendingPathComponent(book.id, isDirectory: true)
        return await Task.detached(priority: .utility) { () -> URL? in
            let fm = FileManager.default
            let original = dir.appendingPathComponent("original.epub")
            if fm.fileExists(atPath: original.path) { return original }
            let content = dir.appendingPathComponent("content", isDirectory: true)
            guard fm.fileExists(atPath: content.path) else { return nil }
            let tmp = dir.appendingPathComponent(".original-\(UUID().uuidString).epub")
            do {
                try fm.zipItem(at: content, to: tmp, shouldKeepParent: false)
                try fm.moveItem(at: tmp, to: original)
                return original
            } catch {
                try? fm.removeItem(at: tmp)
                return nil
            }
        }.value
    }

    func delete(_ book: Book) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(book.id))
        chapterCache = chapterCache.filter { !$0.key.hasPrefix(book.id) }
        reload()
    }
}
