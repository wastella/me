import Foundation

/// A book in the library. Stored as meta.json next to the extracted EPUB contents.
struct Book: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var author: String
    var chapters: [ChapterRef]
    /// Path of the cover image relative to the book's content folder.
    var coverPath: String?
    var addedAt: Date
    /// Approximate character count per chapter, filled lazily. Used for progress estimates.
    var chapterLengths: [Int]?

    static func == (a: Book, b: Book) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

struct ChapterRef: Codable, Hashable {
    var title: String
    /// Path of the XHTML file relative to the book's content folder (no fragment).
    var path: String
}

/// One renderable / speakable unit of a chapter.
struct Block: Codable, Hashable {
    enum Kind: String, Codable { case paragraph, heading, image, separator }
    var kind: Kind
    var text: String
    /// Bold / italic runs, offsets in UTF-16 units.
    var runs: [StyleRun] = []
    /// Image path relative to the book's content folder.
    var src: String? = nil
    /// Shown but not read aloud (site watermarks, repeated title, author notes). See SpeechFilter.
    var muted: Bool = false

    var isSpeakable: Bool { (kind == .paragraph || kind == .heading) && !text.isEmpty && !muted }
}

struct StyleRun: Codable, Hashable {
    var start: Int
    var length: Int
    var bold: Bool
    var italic: Bool
}

/// A location in a book. Shared by the reader and the narrator so they always agree.
struct Position: Codable, Hashable, Comparable {
    var chapter: Int
    var block: Int
    /// UTF-16 offset into the block's text.
    var offset: Int = 0

    static let start = Position(chapter: 0, block: 0, offset: 0)

    static func < (a: Position, b: Position) -> Bool {
        (a.chapter, a.block, a.offset) < (b.chapter, b.block, b.offset)
    }
}

struct ProgressRecord: Codable, Hashable {
    var bookID: String
    var position: Position
    var updatedAt: Date
    var device: String
}
