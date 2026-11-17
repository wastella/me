import Foundation
import NaturalLanguage
import KokoroSwift
import MLX
import MLXUtilsLibrary
#if os(iOS)
import UIKit
#endif

/// On-device neural narrator (Kokoro-82M via MLX). Much more natural than the system voices.
///
/// - The model (327 MB) is downloaded once into Application Support and survives reinstalls.
/// - Work runs on one serial queue. iOS doesn't allow GPU work while the app is in the
///   background (screen off in the car), so we switch to the CPU then, and fall back to the
///   CPU if a GPU call fails mid-transition.
final class KokoroEngine: @unchecked Sendable {
    static let shared = KokoroEngine()

    static let sampleRate: Double = 24_000
    static let modelBytes: Int64 = 327_115_152
    static let modelURL = URL(string: "https://huggingface.co/mlx-community/Kokoro-82M-bf16/resolve/main/kokoro-v1_0.safetensors")!

    /// Voices worth offering (from Kokoro's own quality ranking), best first.
    static let voices: [(id: String, name: String, detail: String)] = [
        ("af_heart", "Heart", "American · warm, expressive"),
        ("af_bella", "Bella", "American · bright"),
        ("am_michael", "Michael", "American · calm male"),
        ("am_fenrir", "Fenrir", "American · deep male"),
        ("am_puck", "Puck", "American · lively male"),
        ("af_nicole", "Nicole", "American · soft, close"),
        ("bf_emma", "Emma", "British · clear"),
        ("bm_george", "George", "British · classic narrator"),
        ("bm_fable", "Fable", "British · storyteller"),
        ("af_aoede", "Aoede", "American · gentle"),
        ("af_kore", "Kore", "American · steady"),
        ("am_liam", "Liam", "American · young male"),
    ]

    static var directory: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Narrate/Kokoro", isDirectory: true)
    }
    static var modelFile: URL { directory.appendingPathComponent("kokoro-v1_0.safetensors") }

    static var isInstalled: Bool {
        let size = (try? FileManager.default.attributesOfItem(atPath: modelFile.path)[.size] as? NSNumber)?.int64Value
        return size == modelBytes
    }

    let queue = DispatchQueue(label: "narrate.kokoro", qos: .utility)
    private var tts: KokoroTTS?
    private var voiceTable: [String: MLXArray] = [:]
    private let lock = NSLock()
    private var _background = false
    /// Set from the main thread when the app goes to / comes back from the background.
    var inBackground: Bool {
        get { lock.withLock { _background } }
        set { lock.withLock { _background = newValue } }
    }

    private init() {
        #if os(iOS)
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inBackground = true }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.inBackground = true }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inBackground = false }
        #endif
        Memory.cacheLimit = 96 * 1024 * 1024
    }

    struct Word { let range: NSRange; let start: Double; let end: Double }
    struct Chunk { let range: NSRange; let samples: [Float]; let words: [Word] }

    enum EngineError: Error { case notInstalled, voiceMissing }

    /// Must be called on `queue`.
    func loadIfNeeded() throws {
        if tts != nil { return }
        guard Self.isInstalled else { throw EngineError.notInstalled }
        guard let voicesURL = Bundle.main.url(forResource: "kokoro-voices", withExtension: "npz") else { throw EngineError.voiceMissing }
        voiceTable = NpyzReader.read(fileFromPath: voicesURL) ?? [:]
        tts = try Self.onDevice(cpu: inBackground) { KokoroTTS(modelPath: Self.modelFile) }
    }

    /// Splits text into chunks Kokoro can take (≤ ~260 chars, on sentence boundaries).
    /// The first chunk is kept short so audio starts quickly.
    static func chunks(of text: String) -> [NSRange] {
        let tok = NLTokenizer(unit: .sentence)
        tok.string = text
        var sentences = tok.tokens(for: text.startIndex..<text.endIndex).map { NSRange($0, in: text) }
        if sentences.isEmpty { sentences = [NSRange(location: 0, length: (text as NSString).length)] }
        var out: [NSRange] = []
        var current: NSRange?
        for s in sentences {
            // Very long "sentences" (no punctuation): split on spaces.
            for piece in splitLong(s, in: text as NSString, max: 300) {
                let limit = out.isEmpty ? 120 : 260
                if let c = current, c.length + piece.length <= limit {
                    current = NSUnionRange(c, piece)
                } else {
                    if let c = current { out.append(c) }
                    current = piece
                }
            }
        }
        if let c = current { out.append(c) }
        return out
    }

    private static func splitLong(_ r: NSRange, in ns: NSString, max: Int) -> [NSRange] {
        guard r.length > max else { return [r] }
        var out: [NSRange] = []
        var start = r.location
        let end = NSMaxRange(r)
        while end - start > max {
            var cut = start + max
            while cut > start + max / 2, ns.character(at: cut) != 32 { cut -= 1 }
            if cut <= start + max / 2 { cut = start + max }
            out.append(NSRange(location: start, length: cut - start))
            start = cut
        }
        out.append(NSRange(location: start, length: end - start))
        return out
    }

    /// Synthesizes one chunk of `text`. Must be called on `queue`.
    func synthesize(_ text: String, range: NSRange, voice: String) throws -> Chunk {
        try loadIfNeeded()
        guard let tts else { throw EngineError.notInstalled }
        let key = voiceTable["\(voice).npy"] != nil ? "\(voice).npy" : "af_heart.npy"
        guard let style = voiceTable[key] else { throw EngineError.voiceMissing }
        let piece = (text as NSString).substring(with: range)
        let language: Language = voice.hasPrefix("b") ? .enGB : .enUS

        let (samples, tokens) = try Self.onDevice(cpu: inBackground) {
            try tts.generateAudio(voice: style, language: language, text: piece)
        }

        // Map Kokoro's word tokens back onto the book text (for the highlight).
        var words: [Word] = []
        let ns = piece as NSString
        var cursor = 0
        for t in tokens ?? [] {
            guard let start = t.start_ts, let end = t.end_ts else { continue }
            let word = t.text.trimmingCharacters(in: .whitespaces)
            guard !word.isEmpty, word.rangeOfCharacter(from: .alphanumerics) != nil else { continue }
            let found = ns.range(of: word, options: [.caseInsensitive], range: NSRange(location: cursor, length: ns.length - cursor))
            guard found.location != NSNotFound else { continue }
            cursor = NSMaxRange(found)
            words.append(Word(range: NSRange(location: range.location + found.location, length: found.length),
                              start: Double(start), end: Double(end)))
        }
        return Chunk(range: range, samples: samples, words: words)
    }

    /// Runs MLX work on the GPU normally, on the CPU in the background (or if the GPU refuses).
    private static func onDevice<T>(cpu: Bool, _ body: () throws -> T) throws -> T {
        if !cpu {
            do { return try withError { try Device.withDefaultDevice(.gpu) { try body() } } }
            catch { /* e.g. "not permitted in background": retry on CPU */ }
        }
        return try withError { try Device.withDefaultDevice(.cpu) { try body() } }
    }

    /// Short sample for the voice picker.
    func preview(voice: String, completion: @escaping @Sendable ([Float]?) -> Void) {
        queue.async {
            let text = "The night was quiet. Then, somewhere in the dark, something moved."
            let chunk = try? self.synthesize(text, range: NSRange(location: 0, length: (text as NSString).length), voice: voice)
            completion(chunk?.samples)
        }
    }
}

/// Downloads the Kokoro model with progress. One instance, observed by Settings.
@MainActor
final class KokoroDownloader: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = KokoroDownloader()
    @Published var progress: Double?
    @Published var error: String?
    @Published var installed = KokoroEngine.isInstalled
    private var task: URLSessionDownloadTask?

    func start() {
        guard task == nil, !installed else { return }
        error = nil
        progress = 0
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        task = session.downloadTask(with: KokoroEngine.modelURL)
        task?.resume()
    }

    func cancel() { task?.cancel(); task = nil; progress = nil }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : KokoroEngine.modelBytes
        let p = Double(totalBytesWritten) / Double(total)
        MainActor.assumeIsolated { self.progress = p }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: KokoroEngine.directory, withIntermediateDirectories: true)
            try? fm.removeItem(at: KokoroEngine.modelFile)
            try fm.moveItem(at: location, to: KokoroEngine.modelFile)
            var url = KokoroEngine.modelFile
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        } catch {
            let msg = error.localizedDescription
            MainActor.assumeIsolated { self.error = msg }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let msg = error.map { ($0 as NSError).code == NSURLErrorCancelled ? nil : $0.localizedDescription } ?? nil
        MainActor.assumeIsolated {
            self.task = nil
            self.progress = nil
            self.installed = KokoroEngine.isInstalled
            if let msg { self.error = msg } else if !self.installed && self.error == nil { self.error = "Download incomplete. Try again." }
            session.finishTasksAndInvalidate()
        }
    }
}

#if DEBUG
extension KokoroEngine {
    /// NARRATE_KOKORO_BENCH=1: prints real-time factors on GPU and CPU, then exits.
    static func benchAndExit() {
        func print(_ items: Any...) { FileHandle.standardError.write((items.map { "\($0)" }.joined(separator: " ") + "\n").data(using: .utf8)!) }
        print("KOKORO bench starting, installed=\(isInstalled)")
        let text = """
        Sunny stared at the shadow for a long time. It did not move, which was strange, because shadows were supposed to move. \
        He sighed, rubbed his eyes, and looked again. "Alright," he muttered. "What do you want from me?" The shadow, of course, said nothing.
        """
        let engine = KokoroEngine.shared
        engine.queue.async {
            for cpu in [false, true, false] {
                engine.inBackground = cpu
                let t0 = Date()
                var audio = 0.0
                do {
                    for r in chunks(of: text) {
                        let c = try engine.synthesize(text, range: r, voice: "af_heart")
                        audio += Double(c.samples.count) / sampleRate
                        if r.location == 0 { print("KOKORO first chunk \(String(format: "%.2f", Date().timeIntervalSince(t0)))s, words \(c.words.count)") }
                    }
                } catch { print("KOKORO error", error) }
                let secs = Date().timeIntervalSince(t0)
                print("KOKORO \(cpu ? "CPU" : "GPU"): \(String(format: "%.1f", audio))s audio in \(String(format: "%.2f", secs))s → \(String(format: "%.1f", audio / secs))× real time")
            }
            exit(0)
        }
    }
}
#endif
