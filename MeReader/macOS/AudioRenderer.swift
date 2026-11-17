import Foundation
import AVFoundation
import AppKit
import ServiceManagement

/// Prepares Kokoro audio on the Mac, in the background, whenever the Mac is on.
///
/// For each of your recent books it keeps a rolling window of chapters ready, starting at your
/// current place (chapter 1 for a book you just added): it renders the next missing chapter,
/// writes it to iCloud Drive › Narrate › Audio, and deletes chapters you've finished. The
/// iPhone copies them ahead of time and plays them, screen off, in the car.
@MainActor
final class AudioRenderer: ObservableObject {
    static let shared = AudioRenderer()

    struct Work: Equatable { var title: String; var chapter: Int; var fraction: Double }

    @Published private(set) var current: Work?
    /// Per book: chapters ready ahead of your place, and how many hours that is.
    @Published private(set) var ready: [String: (chapters: Int, hours: Double)] = [:]
    @Published private(set) var error: String?

    @Published var enabled: Bool = UserDefaults.standard.object(forKey: "renderEnabled") as? Bool ?? true {
        didSet { UserDefaults.standard.set(enabled, forKey: "renderEnabled"); if !enabled { cancel.set() }; poke() }
    }
    @Published var voice: String = UserDefaults.standard.string(forKey: "kokoroVoice") ?? "af_heart" {
        didSet { UserDefaults.standard.set(voice, forKey: "kokoroVoice"); if voice != oldValue { cancel.set() }; poke() }
    }
    @Published var hoursAhead: Double = UserDefaults.standard.object(forKey: "renderHours") as? Double ?? 6 {
        didSet { UserDefaults.standard.set(hoursAhead, forKey: "renderHours"); poke() }
    }
    @Published var openAtLogin: Bool = SMAppService.mainApp.status == .enabled {
        didSet {
            guard openAtLogin != (SMAppService.mainApp.status == .enabled) else { return }
            do { openAtLogin ? try SMAppService.mainApp.register() : try SMAppService.mainApp.unregister() }
            catch { self.error = "Open at login: \(error.localizedDescription)" }
        }
    }

    private var loop: Task<Void, Never>?
    private var poked = false
    private var cancel = Flag()
    private var activity: NSObjectProtocol?

    /// Starts the background loop (once). Called at launch.
    func start() {
        guard loop == nil else { return }
        // Leftovers from a render that was interrupted (app quit mid-chapter).
        let fm = FileManager.default
        for f in (try? fm.contentsOfDirectory(at: RenderedAudio.localCache, includingPropertiesForKeys: nil)) ?? []
        where f.lastPathComponent.hasPrefix("tmp-") { try? fm.removeItem(at: f) }
        // First launch from /Applications: open at login, so audio is prepared whenever the Mac is on.
        if !UserDefaults.standard.bool(forKey: "loginItemOffered2"), Bundle.main.bundlePath.hasPrefix("/Applications") {
            UserDefaults.standard.set(true, forKey: "loginItemOffered2")
            try? SMAppService.mainApp.register()
            openAtLogin = SMAppService.mainApp.status == .enabled
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { AudioRenderer.shared.poke() }
        }
        loop = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)   // let the first sync finish
            while !Task.isCancelled {
                guard let self else { return }
                if await !self.step() { await self.idle(seconds: 60) }
            }
        }
    }

    /// Something changed (new book, new position, settings): look for work now.
    func poke() { poked = true }

    private func idle(seconds: Int) async {
        poked = false
        for _ in 0..<seconds where !poked { try? await Task.sleep(nanoseconds: 1_000_000_000) }
    }

    /// Renders one chapter if anything needs it. Returns false when there was nothing to do.
    private func step() async -> Bool {
        guard enabled else { current = nil; return false }
        guard KokoroEngine.isInstalled else {
            error = "Download the Kokoro voice in Settings to prepare audio."
            return false
        }
        cleanUp()
        guard let job = nextJob() else { current = nil; endActivity(); return false }
        let (book, chapter, blocks) = job
        current = Work(title: book.title, chapter: chapter, fraction: 0)
        beginActivity()

        let dir = RenderedAudio.directory(bookID: book.id)
        let tmp = RenderedAudio.localCache.appendingPathComponent("tmp-\(UUID().uuidString).m4a")
        cancel = Flag()
        let flag = cancel, voice = self.voice
        let result: Result<RenderedChapter, Error> = await withCheckedContinuation { cont in
            KokoroEngine.shared.queue.async {
                do {
                    let m = try Self.render(blocks: blocks, voice: voice, to: tmp, cancel: flag) { f in
                        DispatchQueue.main.async { MainActor.assumeIsolated {
                            if AudioRenderer.shared.current?.chapter == chapter { AudioRenderer.shared.current?.fraction = f }
                        } }
                    }
                    try Self.publish(audio: tmp, manifest: m, chapter: chapter, in: dir)
                    cont.resume(returning: .success(m))
                } catch {
                    try? FileManager.default.removeItem(at: tmp)
                    cont.resume(returning: .failure(error))
                }
            }
        }
        switch result {
        case .success:
            error = nil
        case .failure(let e):
            if !(e is CancellationError) {
                error = "Chapter \(chapter + 1): \(e.localizedDescription)"
                await idle(seconds: 30)   // don't spin on a chapter that keeps failing
            }
        }
        return true
    }

    // MARK: Choosing what to render

    /// Books you're likely to listen to next, most important first: the one playing, then the
    /// ones you've listened to or read most recently, then books you added but haven't opened.
    /// Adding a book doesn't push it ahead of the one you're actually in.
    private var candidateBooks: [Book] {
        let app = AppModel.shared
        let opened = app.library.books.filter { app.progress.records[$0.id] != nil }
            .sorted { app.progress.records[$0.id]!.updatedAt > app.progress.records[$1.id]!.updatedAt }
        let unopened = app.library.books.filter { app.progress.records[$0.id] == nil }
            .sorted { $0.addedAt > $1.addedAt }
        var books = opened + unopened
        if let playing = app.narrator.book, let i = books.firstIndex(of: playing) { books.insert(books.remove(at: i), at: 0) }
        return Array(books.prefix(3))
    }

    /// How much of a book is ready ahead of your place, and the first chapter that still needs audio.
    private struct Window { var book: Book; var chapters = 0; var seconds = 0.0; var missing: (Int, [Block])? }

    private func window(for book: Book) -> Window {
        let app = AppModel.shared
        var w = Window(book: book)
        var c = app.progress.position(for: book.id).chapter
        while c < book.chapters.count, w.seconds < hoursAhead * 3600 {
            let blocks = app.library.blocks(book, chapter: c)
            if let m = RenderedAudio.available(book, chapter: c, blocks: blocks), m.voice == voice {
                w.seconds += m.duration; w.chapters += 1
            } else if blocks.contains(where: \.isSpeakable) {
                w.missing = (c, blocks)
                break
            }
            c += 1
        }
        return w
    }

    /// What to render next:
    /// 1. the next 2 chapters of the book you're in (so it's never waiting behind another book),
    /// 2. the next 2 chapters of each of your other recent books,
    /// 3. then top up whichever book has the least ready, so they all fill up together.
    private func nextJob() -> (Book, Int, [Block])? {
        let windows = candidateBooks.map(window(for:))
        ready = Dictionary(uniqueKeysWithValues: windows.map { ($0.book.id, ($0.chapters, $0.seconds / 3600)) })
        let pending = windows.filter { $0.missing != nil }
        let pick = pending.first(where: { $0.book.id == windows.first?.book.id && $0.chapters < 2 })
            ?? pending.first(where: { $0.chapters < 2 })
            ?? pending.min(by: { $0.seconds < $1.seconds })
        guard let pick, let (chapter, blocks) = pick.missing else { return nil }
        return (pick.book, chapter, blocks)
    }

    /// Keeps iCloud tidy: audio only for your 3 recent books, and only from one chapter behind your place.
    private func cleanUp() {
        guard let folder = AppModel.shared.progress.sync.resolve() else { return }
        let fm = FileManager.default
        let audio = folder.appendingPathComponent("Audio", isDirectory: true)
        let app = AppModel.shared
        let keep = Set(candidateBooks.map(\.id))
        for dir in (try? fm.contentsOfDirectory(at: audio, includingPropertiesForKeys: nil)) ?? [] {
            let id = dir.lastPathComponent
            if id.hasPrefix(".") { continue }
            guard keep.contains(id), let book = app.library.book(id: id) else {
                try? fm.removeItem(at: dir)   // runs between chapters, so nothing is being written there
                continue
            }
            let keepFrom = app.progress.position(for: book.id).chapter - 1
            for f in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] {
                if let n = Int(f.deletingPathExtension().lastPathComponent), n < keepFrom { try? fm.removeItem(at: f) }
            }
        }
    }

    // MARK: Rendering (on the Kokoro queue)

    nonisolated private static func render(blocks: [Block], voice: String, to url: URL, cancel: Flag,
                                           progress: (Double) -> Void) throws -> RenderedChapter {
        let engine = KokoroEngine.shared
        let rate = KokoroEngine.sampleRate
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
        let file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
        ], commonFormat: .pcmFormatFloat32, interleaved: false)

        var frames: Int64 = 0
        func write(_ samples: [Float]) throws {
            guard !samples.isEmpty, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else { return }
            buf.frameLength = AVAudioFrameCount(samples.count)
            samples.withUnsafeBufferPointer { buf.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
            try file.write(from: buf)
            frames += Int64(samples.count)
        }
        var now: Double { Double(frames) / rate }

        let total = blocks.filter(\.isSpeakable).reduce(0) { $0 + $1.text.utf16.count }
        var done = 0, ok = 0, failed = 0
        var lastError: Error?
        var timings: [RenderedChapter.BlockTiming] = []
        for (i, block) in blocks.enumerated() where block.isSpeakable {
            let start = now
            var words: [RenderedChapter.Word] = []
            for r in KokoroEngine.chunks(of: block.text) {
                if cancel.isSet { file.close(); throw CancellationError() }
                let chunk: KokoroEngine.Chunk
                do { chunk = try engine.synthesize(block.text, range: r, voice: voice); ok += 1 }
                catch {
                    // An odd sentence can fail; a broken engine fails everything, so give up then.
                    failed += 1; lastError = error
                    if failed >= 3 && failed > ok { file.close(); throw error }
                    continue
                }
                for w in chunk.words { words.append(.init(loc: w.range.location, len: w.range.length, t: now + w.start)) }
                try write(chunk.samples)
            }
            try write([Float](repeating: 0, count: Int((block.kind == .heading ? 0.9 : 0.35) * rate)))
            timings.append(.init(block: i, start: start, end: now, words: words))
            done += block.text.utf16.count
            progress(Double(done) / Double(max(1, total)))
        }
        let duration = now
        file.close()
        if ok == 0, let lastError { throw lastError }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue
        return RenderedChapter(version: RenderedChapter.currentVersion, voice: voice, textHash: RenderedChapter.hash(of: blocks),
                               duration: duration, renderedAt: Date(), audioBytes: bytes, blocks: timings)
    }

    /// Moves the audio into place, then writes the manifest (its presence means "complete").
    nonisolated private static func publish(audio: URL, manifest: RenderedChapter, chapter: Int, in dir: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent("\(chapter).m4a")
        let json = dir.appendingPathComponent("\(chapter).json")
        var coordErr: NSError?
        var err: Error?
        NSFileCoordinator().coordinate(writingItemAt: json, options: .forDeleting, error: &coordErr) { try? fm.removeItem(at: $0) }
        NSFileCoordinator().coordinate(writingItemAt: dest, options: .forReplacing, error: &coordErr) { url in
            do {
                try? fm.removeItem(at: url)
                try fm.moveItem(at: audio, to: url)
            } catch { err = error }
        }
        if let e = coordErr ?? err { throw e }
        let data = try JSONEncoder.iso.encode(manifest)
        NSFileCoordinator().coordinate(writingItemAt: json, options: .forReplacing, error: &coordErr) { url in
            do { try data.write(to: url) } catch { err = error }
        }
        if let e = coordErr ?? err { throw e }
    }

    // MARK: Keep working while the window is hidden (no App Nap), without keeping the Mac awake.

    private func beginActivity() {
        guard activity == nil else { return }
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep],
                                                         reason: "Preparing narration audio")
    }

    private func endActivity() {
        if let a = activity { ProcessInfo.processInfo.endActivity(a) }
        activity = nil
    }

    final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        var isSet: Bool { lock.withLock { value } }
        func set() { lock.withLock { value = true } }
    }
}
