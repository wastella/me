import Foundation
import AVFoundation

/// Audio the Mac prepared ahead of time with the Kokoro neural voice, one file per chapter.
///
/// Layout in the sync folder (and in the local cache on the iPhone):
///   Audio/<bookID>/<chapter>.m4a   AAC, 24 kHz mono
///   Audio/<bookID>/<chapter>.json  manifest below (written last, so its presence means "complete")
///
/// The manifest times every speakable block and word, so the phone can highlight words and
/// keep the shared position exact while it plays the file with the screen off.
struct RenderedChapter: Codable {
    static let currentVersion = 1

    struct Word: Codable { var loc: Int; var len: Int; var t: Double }
    struct BlockTiming: Codable {
        var block: Int
        var start: Double
        var end: Double
        var words: [Word]
    }

    var version: Int
    var voice: String
    /// Fingerprint of the speakable text; if the text filter changes, the chapter is re-rendered.
    var textHash: String
    var duration: Double
    var renderedAt: Date
    /// Size of the .m4a it belongs to, so a device never pairs it with an older audio file.
    var audioBytes: Int?
    var blocks: [BlockTiming]

    func timing(for block: Int) -> BlockTiming? { blocks.first { $0.block == block } }

    /// Seconds into the file where `pos` (in this chapter) is spoken.
    func time(at pos: Position) -> Double? {
        guard let b = timing(for: pos.block) ?? blocks.first(where: { $0.block > pos.block }) else { return nil }
        guard b.block == pos.block, pos.offset > 0 else { return b.start }
        return b.words.last(where: { $0.loc <= pos.offset })?.t ?? b.start
    }

    /// The position spoken at `t` seconds.
    func position(at t: Double, chapter: Int) -> Position? {
        guard let b = blocks.last(where: { $0.start <= t }) ?? blocks.first else { return nil }
        let w = b.words.last(where: { $0.t <= t })
        return Position(chapter: chapter, block: b.block, offset: w?.loc ?? 0)
    }

    /// Stable text fingerprint (FNV-1a; Swift's Hasher is randomized per launch).
    static func hash(of blocks: [Block]) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for (i, b) in blocks.enumerated() where b.isSpeakable {
            for byte in "\(i):\(b.text)\n".utf8 { h = (h ^ UInt64(byte)) &* 0x100000001b3 }
        }
        return String(h, radix: 16)
    }
}

/// Finds rendered chapters on this device.
enum RenderedAudio {
    /// Where this device plays rendered chapters from.
    /// - iPhone: a local cache, filled from the sync folder ahead of time (works offline in the car).
    /// - Mac: the sync folder itself, where the renderer writes them (no second copy on a full disk).
    @MainActor static func directory(bookID: String) -> URL {
        #if os(macOS)
        if let folder = AppModel.shared.progress.sync.resolve() {
            return folder.appendingPathComponent("Audio/\(bookID)", isDirectory: true)
        }
        #endif
        return localCache.appendingPathComponent(bookID, isDirectory: true)
    }

    static var localCache: URL {
        #if os(macOS)
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        #else
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        #endif
        return base.appendingPathComponent("Narrate/Audio", isDirectory: true)
    }

    @MainActor static func audioURL(bookID: String, chapter: Int) -> URL { directory(bookID: bookID).appendingPathComponent("\(chapter).m4a") }
    @MainActor static func manifestURL(bookID: String, chapter: Int) -> URL { directory(bookID: bookID).appendingPathComponent("\(chapter).json") }

    /// Whether to play prepared audio at all (Settings).
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "useKokoro") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "useKokoro") }
    }

    /// The manifest if this chapter should be played from prepared audio here.
    @MainActor
    static func ready(_ book: Book, chapter: Int, blocks: [Block]) -> RenderedChapter? {
        enabled ? available(book, chapter: chapter, blocks: blocks) : nil
    }

    /// The manifest if this chapter's audio is on this device and still matches the book text.
    @MainActor
    static func available(_ book: Book, chapter: Int, blocks: [Block]) -> RenderedChapter? {
        let key = "\(book.id)#\(chapter)"
        let audio = audioURL(bookID: book.id, chapter: chapter)
        let file = manifestURL(bookID: book.id, chapter: chapter)
        let mtime = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? nil
        if let c = cache[key], c.mtime == mtime { return c.manifest }
        guard FileManager.default.fileExists(atPath: audio.path),
              let data = try? Data(contentsOf: file),
              let m = try? JSONDecoder.iso.decode(RenderedChapter.self, from: data),
              m.version == RenderedChapter.currentVersion,
              m.textHash == RenderedChapter.hash(of: blocks)
        else { cache[key] = (mtime, nil); return nil }
        cache[key] = (mtime, m)
        return m
    }

    @MainActor private static var cache: [String: (mtime: Date?, manifest: RenderedChapter?)] = [:]
}
