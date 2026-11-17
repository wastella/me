import Foundation
import AVFoundation
import MediaPlayer
import NaturalLanguage
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Generates the audiobook on the fly with on-device text-to-speech.
///
/// Pipeline: text block → AVSpeechSynthesizer.write (faster than real time) → PCM buffers →
/// AVAudioPlayerNode → time-pitch (speed) → output. While synthesizing we record, for every
/// word, the frame at which it begins; while playing we count frames actually played back, so
/// we always know the exact word being spoken. That word *is* the book position, shared with
/// the reader — so switching between reading and listening is seamless.
@MainActor
final class Narrator: NSObject, ObservableObject {
    // MARK: Published state
    @Published private(set) var book: Book?
    @Published private(set) var isPlaying = false
    @Published private(set) var position: Position = .start
    /// Range of the word being spoken within `position.block`'s text (UTF-16).
    @Published private(set) var wordRange: NSRange?
    @Published private(set) var isBuffering = false
    @Published var rate: Double = UserDefaults.standard.object(forKey: "rate") as? Double ?? 1.0 {
        didSet {
            UserDefaults.standard.set(rate, forKey: "rate")
            timePitch.rate = Float(rate)
            updateNowPlaying(full: false)
        }
    }
    @Published var voiceID: String? = UserDefaults.standard.string(forKey: "voiceID") {
        didSet {
            UserDefaults.standard.set(voiceID, forKey: "voiceID")
            if isPlaying { restart(at: position) }
        }
    }
    @Published var sleepTimerEnd: Date?
    /// Kokoro voice of the audio being played when it was prepared by the Mac, nil for the system voice.
    @Published private(set) var preparedVoice: String?

    private weak var library: Library?
    private weak var progress: ProgressStore?

    // MARK: Audio graph
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let timePitch = AVAudioUnitTimePitch()
    nonisolated static let sampleRate: Double = 44_100
    private let outFormat = AVAudioFormat(standardFormatWithSampleRate: Narrator.sampleRate, channels: 1)!
    private var synth: AVSpeechSynthesizer?

    // Shared with audio/synthesis threads.
    private let shared = SharedCounters()

    // MARK: Segments (main actor)
    private struct Segment {
        var chapter: Int
        var block: Int
        var baseOffset: Int
        var length: Int
        var startFrame: Int64
        var markers: [(frame: Int64, range: NSRange)] = []
        var endFrame: Int64?
    }
    private var segments: [Segment] = []
    private var nextToSynthesize: Position?
    private var synthesizing = false
    private var generation = 0
    private var timer: Timer?
    private var lastSavedBlock: (Int, Int)?
    private var lastSaveTime = Date.distantPast
    private var lastNowPlayingUpdate = Date.distantPast
    private var nowPlayingChapter: Int = -1
    private var cachedArtwork: (String, MPMediaItemArtwork)?
    /// Observed speaking speed at 1x, used for time estimates. Starts with a typical value.
    private var charsPerSecond: Double = UserDefaults.standard.object(forKey: "cps") as? Double ?? 15.0

    private let lookaheadSeconds: Double = 25

    override init() {
        super.init()
        engine.attach(player)
        engine.attach(timePitch)
        engine.connect(player, to: timePitch, format: outFormat)
        engine.connect(timePitch, to: engine.mainMixerNode, format: outFormat)
        timePitch.rate = Float(rate)
        engine.prepare()
        setupRemoteCommands()
        NotificationCenter.default.addObserver(self, selector: #selector(engineConfigChanged), name: .AVAudioEngineConfigurationChange, object: engine)
        #if os(iOS)
        let s = AVAudioSession.sharedInstance()
        NotificationCenter.default.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: s)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChange(_:)), name: AVAudioSession.routeChangeNotification, object: s)
        #endif
    }

    func attach(library: Library, progress: ProgressStore) {
        self.library = library
        self.progress = progress
    }

    // MARK: Public controls

    /// Called for "play" from the lock screen, steering wheel or CarPlay. The app sets this so
    /// those presses sync with your other devices first (and work even when no book is loaded).
    var remotePlayHandler: (() -> Void)?

    /// When a car / headphones were just connected. Many cars send "play" automatically on
    /// connect; we ignore those so MeReader only starts when you actually press play.
    private var outputConnectedAt: Date?
    private var isAutoPlayOnConnect: Bool {
        !isPlaying && (outputConnectedAt.map { Date().timeIntervalSince($0) < 4 } ?? false)
    }

    /// Starts (or continues) narrating `book` from its saved position (or `position` if given).
    func play(_ book: Book, from start: Position? = nil) {
        let pos = start ?? resumePosition(for: book)
        if self.book?.id != book.id { nowPlayingChapter = -1 }
        self.book = book
        restart(at: clamp(pos, in: book))
    }

    /// Loads a book without playing, so Now Playing / the steering wheel can start it later.
    func prepare(_ book: Book) {
        guard self.book == nil else { return }
        self.book = book
        position = clamp(progress?.position(for: book.id) ?? .start, in: book)
        nowPlayingChapter = -1
        updateNowPlaying(full: true)
    }

    func toggle() { isPlaying ? pause() : resume() }

    func resume() {
        guard let book else { remotePlayHandler?(); return }
        // Pick up any newer position (e.g. you were reading on screen since pausing).
        restart(at: resumePosition(for: book))
    }

    /// The saved position; after a real break (> 5 s) it backs up to the start of that sentence,
    /// so you don't come back in mid-thought after a navigation prompt or a stop.
    private func resumePosition(for book: Book) -> Position {
        let saved = progress?.position(for: book.id) ?? position
        let age = Date().timeIntervalSince(progress?.records[book.id]?.updatedAt ?? .distantPast)
        return age > 5 ? snapToSentenceStart(saved, in: book) : saved
    }

    func pause() {
        guard isPlaying else { return }
        refreshPosition()
        generation += 1
        shared.setGeneration(generation)
        synth?.stopSpeaking(at: .immediate)
        synth = nil
        player.stop()
        engine.pause()
        isPlaying = false
        isBuffering = false
        timer?.invalidate(); timer = nil
        segments.removeAll()
        if let book { progress?.update(book.id, position, pushNow: true) }
        updateNowPlaying(full: true)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// Stop and forget the current book (used when deleting it).
    func stop() {
        pause()
        book = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    /// Jump to a position. Keeps playing if we were playing.
    func seek(to pos: Position) {
        guard let book else { return }
        let p = clamp(pos, in: book)
        if isPlaying { restart(at: p) } else {
            position = p; wordRange = nil
            progress?.update(book.id, p, pushNow: true)
            updateNowPlaying(full: true)
        }
    }

    func skip(seconds: Double) {
        guard let book, let library else { return }
        refreshPosition()
        if let m = currentRendered, let now = m.time(at: position) {
            let t = now + seconds
            if t >= 0, t < m.duration, let p = m.position(at: t, chapter: position.chapter) { seek(to: p); return }
        }
        let chars = Int(abs(seconds) * charsPerSecond)
        var p = position
        if seconds < 0 {
            var remaining = chars
            while remaining > 0 {
                if p.offset >= remaining { p.offset -= remaining; remaining = 0 }
                else {
                    remaining -= p.offset
                    if p.block > 0 { p.block -= 1 }
                    else if p.chapter > 0 { p.chapter -= 1; p.block = max(0, library.blocks(book, chapter: p.chapter).count - 1) }
                    else { p.offset = 0; break }
                    p.offset = library.blocks(book, chapter: p.chapter)[p.block].text.utf16.count
                }
            }
            p = snapToSentenceStart(p, in: book)
        } else {
            var remaining = chars
            while remaining > 0 {
                let blocks = library.blocks(book, chapter: p.chapter)
                let len = blocks.indices.contains(p.block) ? blocks[p.block].text.utf16.count : 0
                if len - p.offset > remaining { p.offset += remaining; remaining = 0 }
                else {
                    remaining -= (len - p.offset)
                    p.offset = 0
                    if p.block + 1 < blocks.count { p.block += 1 }
                    else if p.chapter + 1 < book.chapters.count { p.chapter += 1; p.block = 0 }
                    else { break }
                }
            }
            p = snapToWordStart(p, in: book)
        }
        seek(to: p)
    }

    func nextChapter() {
        guard let book else { return }
        refreshPosition()
        guard position.chapter + 1 < book.chapters.count else { return }
        seek(to: Position(chapter: position.chapter + 1, block: 0))
    }

    func previousChapter() {
        guard let book else { return }
        refreshPosition()
        if position.block > 1 || position.chapter == 0 { seek(to: Position(chapter: position.chapter, block: 0)) }
        else { seek(to: Position(chapter: position.chapter - 1, block: 0)) }
    }

    /// Called by the reader when the user scrolls while paused, so resume starts there.
    func readerMoved(to pos: Position, in book: Book) {
        guard !isPlaying else { return }
        if self.book?.id == book.id { position = pos; wordRange = nil }
    }

    func setSleepTimer(minutes: Int?) {
        sleepTimerEnd = minutes.map { Date().addingTimeInterval(Double($0) * 60) }
    }

    /// The prepared Kokoro audio for the chapter being played, if there is one.
    private var currentRendered: RenderedChapter? {
        guard let book, let library else { return nil }
        return RenderedAudio.ready(book, chapter: position.chapter, blocks: library.blocks(book, chapter: position.chapter))
    }

    /// Estimated time for the rest of the chapter at the current speed.
    var chapterTimeRemaining: TimeInterval {
        if let m = currentRendered { return max(0, m.duration - (m.time(at: position) ?? 0)) / rate }
        guard let book, let library else { return 0 }
        let blocks = library.blocks(book, chapter: position.chapter)
        var chars = 0
        for (i, b) in blocks.enumerated() where i >= position.block && b.isSpeakable {
            chars += b.text.utf16.count - (i == position.block ? position.offset : 0)
        }
        return Double(chars) / charsPerSecond / rate
    }

    /// Fraction of the current chapter already narrated (0...1), from character counts.
    var chapterFraction: Double {
        if let m = currentRendered, m.duration > 0 { return min(1, (m.time(at: position) ?? 0) / m.duration) }
        guard let book, let library else { return 0 }
        let blocks = library.blocks(book, chapter: position.chapter)
        var total = 0, before = 0
        for (i, b) in blocks.enumerated() where b.isSpeakable {
            let len = b.text.utf16.count
            total += len
            if i < position.block { before += len } else if i == position.block { before += min(position.offset, len) }
        }
        return total > 0 ? Double(before) / Double(total) : 0
    }

    /// Estimated length of the current chapter at the current speed.
    var chapterDuration: TimeInterval {
        let f = chapterFraction
        let remaining = chapterTimeRemaining
        return f < 0.999 ? remaining / (1 - f) : remaining
    }

    /// Jumps to a point in the current chapter (0...1), used by the scrubber.
    func seek(chapterFraction f: Double) {
        if let m = currentRendered { seek(toChapterTime: m.duration * max(0, min(1, f))); return }
        guard let book, let library else { return }
        let blocks = library.blocks(book, chapter: position.chapter)
        let total = blocks.filter(\.isSpeakable).reduce(0) { $0 + $1.text.utf16.count }
        seek(toChapterTime: Double(total) * max(0, min(1, f)) / charsPerSecond)
    }

    // MARK: Pipeline

    private func restart(at pos: Position) {
        guard let book else { return }
        generation += 1
        let gen = generation
        synth?.stopSpeaking(at: .immediate)
        synth = nil
        player.stop()
        segments.removeAll()
        shared.reset(generation: gen)
        synthesizing = false
        position = pos
        wordRange = nil
        nextToSynthesize = pos
        progress?.update(book.id, pos, pushNow: true)

        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, policy: .longFormAudio)
        try? session.setActive(true)
        #endif
        if !engine.isRunning {
            do { try engine.start() } catch { print("engine start failed", error); return }
        }
        player.play()
        isPlaying = true
        isBuffering = true
        startTimer()
        synthesizeIfNeeded()
        updateNowPlaying(full: true)
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        guard isPlaying else { return }
        refreshPosition()
        synthesizeIfNeeded()
        if let end = sleepTimerEnd, Date() >= end {
            sleepTimerEnd = nil
            pause()
            return
        }
        // Finished the book?
        if nextToSynthesize == nil && !synthesizing && shared.played >= shared.scheduled && !segments.isEmpty {
            pause()
            return
        }
        if Date().timeIntervalSince(lastNowPlayingUpdate) > 5 || position.chapter != nowPlayingChapter {
            updateNowPlaying(full: position.chapter != nowPlayingChapter)
        }
    }

    /// Maps frames played to the current word.
    private func refreshPosition() {
        guard isPlaying, !segments.isEmpty else { return }
        let played = shared.played
        isBuffering = played >= shared.scheduled && synthesizing
        guard let segIndex = segments.lastIndex(where: { $0.startFrame <= played }) else { return }
        let seg = segments[segIndex]
        var newPos = Position(chapter: seg.chapter, block: seg.block, offset: seg.baseOffset)
        var range: NSRange?
        if let m = seg.markers.last(where: { $0.frame <= played }) {
            newPos.offset = seg.baseOffset + m.range.location
            range = NSRange(location: seg.baseOffset + m.range.location, length: m.range.length)
        }
        if newPos != position { position = newPos }
        if range != wordRange { wordRange = range }
        // Drop segments that finished long ago.
        if segIndex > 2 { segments.removeFirst(segIndex - 2) }
        // Persist on block change, or every 5 seconds.
        if let book, lastSavedBlock.map({ $0 != (newPos.chapter, newPos.block) }) ?? true || Date().timeIntervalSince(lastSaveTime) > 5 {
            lastSavedBlock = (newPos.chapter, newPos.block)
            lastSaveTime = Date()
            progress?.update(book.id, newPos)
        }
    }

    private func synthesizeIfNeeded() {
        guard isPlaying, !synthesizing, let book, let library, var pos = nextToSynthesize else { return }
        let bufferedSeconds = Double(shared.scheduled - shared.played) / Self.sampleRate
        guard bufferedSeconds < lookaheadSeconds else { return }

        // Find the next speakable block at or after `pos`, adding pauses for skipped content.
        var pauseBefore: Double = 0
        while true {
            let blocks = library.blocks(book, chapter: pos.chapter)
            if blocks.indices.contains(pos.block) {
                let b = blocks[pos.block]
                if b.isSpeakable && pos.offset < b.text.utf16.count { break }
                if b.kind == .separator { pauseBefore = max(pauseBefore, 1.0) }
                pos.block += 1; pos.offset = 0
            } else if pos.chapter + 1 < book.chapters.count {
                pos = Position(chapter: pos.chapter + 1, block: 0)
                pauseBefore = max(pauseBefore, 1.5)
            } else {
                nextToSynthesize = nil
                return
            }
        }
        let chapterBlocks = library.blocks(book, chapter: pos.chapter)
        let block = chapterBlocks[pos.block]
        if pauseBefore > 0 { scheduleSilence(seconds: pauseBefore) }
        if let rendered = RenderedAudio.ready(book, chapter: pos.chapter, blocks: chapterBlocks),
           let timing = rendered.timing(for: pos.block) {
            playRendered(book: book, pos: pos, timing: timing, voice: rendered.voice)
            return
        }
        if preparedVoice != nil { preparedVoice = nil }
        let full = block.text as NSString
        let text = full.substring(from: pos.offset)

        let seg = Segment(chapter: pos.chapter, block: pos.block, baseOffset: pos.offset,
                          length: text.utf16.count, startFrame: shared.scheduled)
        segments.append(seg)
        let after = block.kind == .heading ? 0.9 : 0.35
        nextToSynthesize = Position(chapter: pos.chapter, block: pos.block + 1, offset: 0)
        synthesizing = true

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = currentVoice()
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        let s = synth ?? AVSpeechSynthesizer()
        s.delegate = self
        synth = s
        let gen = generation
        let shared = self.shared
        let player = self.player
        let converter = BufferConverter(to: outFormat)
        let startFrames = shared.scheduled
        let chars = text.utf16.count

        let handler = Self.makeBufferHandler(shared: shared, player: player, converter: converter, gen: gen, after: after, learn: true) { [weak self] end in
            guard let self, self.generation == gen else { return }
            if let i = self.segments.lastIndex(where: { $0.startFrame == startFrames }) { self.segments[i].endFrame = end }
            let secs = Double(end - startFrames) / Self.sampleRate - after
            if chars > 200, secs > 1 { self.learnSpeed(chars: chars, seconds: secs) }
            self.synthesizing = false
            self.synthesizeIfNeeded()
        }
        s.write(utterance, toBufferCallback: handler)
    }

    /// Built outside the main actor: the synthesizer calls this on its own thread.
    nonisolated private static func makeBufferHandler(shared: SharedCounters, player: AVAudioPlayerNode, converter: BufferConverter,
                                                      gen: Int, after: Double, learn: Bool,
                                                      onEnd: @escaping @MainActor (Int64) -> Void) -> (AVAudioBuffer) -> Void {
        let finished = OnceFlag()
        return { buffer in
            guard shared.generation == gen, !finished.isSet, let pcm = buffer as? AVAudioPCMBuffer else { return }
            if pcm.frameLength == 0 {
                // The synthesizer can signal the end more than once; only handle it the first time.
                guard finished.set() else { return }
                if let rest = converter.flush() { schedule(rest, on: player, shared: shared, gen: gen) }
                if let pad = converter.silence(seconds: after) { schedule(pad, on: player, shared: shared, gen: gen) }
                let end = shared.scheduled
                DispatchQueue.main.async { MainActor.assumeIsolated { onEnd(end) } }
                return
            }
            if let out = converter.add(pcm) { schedule(out, on: player, shared: shared, gen: gen) }
        }
    }

    /// Plays one block from the chapter file the Mac prepared. Word timings come from the
    /// manifest, so highlighting and the saved position work exactly like live narration.
    private func playRendered(book: Book, pos: Position, timing: RenderedChapter.BlockTiming, voice: String) {
        if preparedVoice != voice { preparedVoice = voice }
        let startWord = pos.offset > 0 ? timing.words.last(where: { $0.loc <= pos.offset }) : nil
        let base = startWord?.loc ?? 0
        let startT = startWord?.t ?? timing.start
        let startFrame = shared.scheduled
        var seg = Segment(chapter: pos.chapter, block: pos.block, baseOffset: base,
                          length: 0, startFrame: startFrame)
        for w in timing.words where w.loc >= base {
            seg.markers.append((startFrame + Int64((w.t - startT) * Self.sampleRate), NSRange(location: w.loc - base, length: w.len)))
        }
        segments.append(seg)
        nextToSynthesize = Position(chapter: pos.chapter, block: pos.block + 1, offset: 0)
        synthesizing = true

        let gen = generation
        let url = RenderedAudio.audioURL(bookID: book.id, chapter: pos.chapter)
        let handler = Self.makeBufferHandler(shared: shared, player: player, converter: BufferConverter(to: outFormat),
                                             gen: gen, after: 0, learn: false) { [weak self] end in
            guard let self, self.generation == gen else { return }
            if let i = self.segments.lastIndex(where: { $0.startFrame == startFrame }) { self.segments[i].endFrame = end }
            self.synthesizing = false
            self.synthesizeIfNeeded()
        }
        let shared = self.shared
        let endT = timing.end
        Self.fileQueue.async {
            Self.read(url: url, from: startT, to: endT, gen: gen, shared: shared, into: handler)
        }
    }

    nonisolated private static let fileQueue = DispatchQueue(label: "narrate.rendered", qos: .userInitiated)

    /// Reads [from, to) seconds of a chapter file and feeds it to `handler`, then signals the end
    /// with an empty buffer. If the file can't be read the block is simply skipped.
    nonisolated private static func read(url: URL, from: Double, to: Double, gen: Int, shared: SharedCounters,
                                         into handler: (AVAudioBuffer) -> Void) {
        defer {
            let fmt = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
            if let end = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 1) { end.frameLength = 0; handler(end) }
        }
        guard let file = try? AVAudioFile(forReading: url) else { return }
        let rate = file.processingFormat.sampleRate
        let first = AVAudioFramePosition(from * rate)
        let last = min(file.length, AVAudioFramePosition(to * rate))
        guard first < last else { return }
        file.framePosition = first
        var remaining = AVAudioFrameCount(last - first)
        while remaining > 0, shared.generation == gen {
            let n = min(remaining, AVAudioFrameCount(rate / 2))
            guard let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: n),
                  (try? file.read(into: buf, frameCount: n)) != nil, buf.frameLength > 0 else { return }
            handler(buf)
            remaining -= min(remaining, buf.frameLength)
        }
    }

    nonisolated private static func schedule(_ buf: AVAudioPCMBuffer, on player: AVAudioPlayerNode, shared: SharedCounters, gen: Int) {
        guard shared.generation == gen else { return }
        let frames = Int64(buf.frameLength)
        shared.addScheduled(frames)
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { _ in
            shared.addPlayed(frames, gen: gen)
        }
    }

    private func scheduleSilence(seconds: Double) {
        let frames = AVAudioFrameCount(seconds * Self.sampleRate)
        guard let buf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: frames) else { return }
        buf.frameLength = frames
        Self.schedule(buf, on: player, shared: shared, gen: generation)
    }

    private func learnSpeed(chars: Int, seconds: Double) {
        let observed = Double(chars) / seconds
        guard observed > 5, observed < 40 else { return }
        charsPerSecond = charsPerSecond * 0.8 + observed * 0.2
        UserDefaults.standard.set(charsPerSecond, forKey: "cps")
    }

    fileprivate func markerArrived(range: NSRange, frame: Int64, gen: Int) {
        guard gen == generation, var seg = segments.last else { return }
        seg.markers.append((frame, range))
        segments[segments.count - 1] = seg
    }

    // MARK: Voices

    func currentVoice() -> AVSpeechSynthesisVoice? {
        if let id = voiceID, let v = AVSpeechSynthesisVoice(identifier: id) { return v }
        return Self.bestVoices().first
    }

    /// English voices, best quality first, novelty voices removed.
    static func bestVoices() -> [AVSpeechSynthesisVoice] {
        let novelty = ["com.apple.speech.synthesis", "com.apple.eloquence"]
        let lang = Locale.preferredLanguages.first?.prefix(2) ?? "en"
        return AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(String(lang)) || $0.language.hasPrefix("en") }
            .filter { v in !novelty.contains(where: { v.identifier.hasPrefix($0) }) }
            .sorted { a, b in
                if a.quality.rawValue != b.quality.rawValue { return a.quality.rawValue > b.quality.rawValue }
                let ua = a.language == "en-US", ub = b.language == "en-US"
                if ua != ub { return ua }
                return a.name < b.name
            }
    }

    private var previewSynth: AVSpeechSynthesizer?
    func preview(voice: AVSpeechSynthesisVoice) {
        let s = previewSynth ?? AVSpeechSynthesizer()
        previewSynth = s
        s.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: "Hi, I'm \(voice.name). I'll read your book to you.")
        u.voice = voice
        s.speak(u)
    }

    // MARK: Helpers

    private func clamp(_ p: Position, in book: Book) -> Position {
        guard let library else { return p }
        var q = p
        q.chapter = min(max(0, q.chapter), book.chapters.count - 1)
        let blocks = library.blocks(book, chapter: q.chapter)
        q.block = min(max(0, q.block), max(0, blocks.count - 1))
        let len = blocks.indices.contains(q.block) ? blocks[q.block].text.utf16.count : 0
        q.offset = min(max(0, q.offset), len)
        return q
    }

    private func snapToSentenceStart(_ p: Position, in book: Book) -> Position {
        guard let library else { return p }
        let blocks = library.blocks(book, chapter: p.chapter)
        guard blocks.indices.contains(p.block) else { return p }
        let text = blocks[p.block].text
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        var best = 0
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let start = range.lowerBound.utf16Offset(in: text)
            if start <= p.offset { best = start; return true }
            return false
        }
        var q = p; q.offset = best
        return q
    }

    private func snapToWordStart(_ p: Position, in book: Book) -> Position {
        guard let library else { return p }
        let blocks = library.blocks(book, chapter: p.chapter)
        guard blocks.indices.contains(p.block) else { return p }
        let u = Array(blocks[p.block].text.utf16)
        var i = min(p.offset, u.count)
        while i > 0 && u[i - 1] != 32 { i -= 1 }
        var q = p; q.offset = i
        return q
    }

    // MARK: Now Playing / remote commands (lock screen, CarPlay, AirPods, steering wheel)

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.isAutoPlayOnConnect { return .commandFailed }
            if let h = self.remotePlayHandler { h() } else { self.resume() }
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.isAutoPlayOnConnect { return .commandFailed }
            if self.isPlaying { self.pause() } else if let h = self.remotePlayHandler { h() } else { self.resume() }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [15]
        c.skipBackwardCommand.preferredIntervals = [15]
        c.skipForwardCommand.addTarget { [weak self] _ in self?.skip(seconds: 15); return .success }
        c.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(seconds: -15); return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.nextChapter(); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.previousChapter(); return .success }
        c.changePlaybackRateCommand.supportedPlaybackRates = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map { NSNumber(value: $0) }
        c.changePlaybackRateCommand.addTarget { [weak self] e in
            if let e = e as? MPChangePlaybackRateCommandEvent { self?.rate = Double(e.playbackRate) }
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(toChapterTime: e.positionTime)
            return .success
        }
    }

    /// Seeks within the current chapter using the estimated timeline (scrubbing in CarPlay / lock screen).
    private func seek(toChapterTime t: TimeInterval) {
        if let m = currentRendered, let p = m.position(at: t, chapter: position.chapter) { seek(to: p); return }
        guard let book, let library else { return }
        let blocks = library.blocks(book, chapter: position.chapter)
        var target = Int(t * charsPerSecond)
        for (i, b) in blocks.enumerated() where b.isSpeakable {
            let len = b.text.utf16.count
            if target < len {
                seek(to: snapToWordStart(Position(chapter: position.chapter, block: i, offset: target), in: book))
                return
            }
            target -= len
        }
    }

    private func updateNowPlaying(full: Bool) {
        guard let book, let library else { return }
        lastNowPlayingUpdate = Date()
        let blocks = library.blocks(book, chapter: position.chapter)
        var total = 0, before = 0
        for (i, b) in blocks.enumerated() where b.isSpeakable {
            let len = b.text.utf16.count
            if i < position.block { before += len } else if i == position.block { before += position.offset }
            total += len
        }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        if full || nowPlayingChapter != position.chapter {
            nowPlayingChapter = position.chapter
            info[MPMediaItemPropertyTitle] = book.chapters[position.chapter].title
            info[MPMediaItemPropertyArtist] = book.author
            info[MPMediaItemPropertyAlbumTitle] = book.title
            info[MPNowPlayingInfoPropertyChapterNumber] = position.chapter
            info[MPNowPlayingInfoPropertyChapterCount] = book.chapters.count
            info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
            if let art = artwork(for: book) { info[MPMediaItemPropertyArtwork] = art }
        }
        if let m = RenderedAudio.ready(book, chapter: position.chapter, blocks: blocks) {
            info[MPMediaItemPropertyPlaybackDuration] = m.duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = m.time(at: position) ?? 0
        } else {
            info[MPMediaItemPropertyPlaybackDuration] = Double(total) / charsPerSecond
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(before) / charsPerSecond
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        #if os(macOS)
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
        #endif
    }

    private func artwork(for book: Book) -> MPMediaItemArtwork? {
        if let (id, art) = cachedArtwork, id == book.id { return art }
        guard let url = library?.coverURL(book) else { return nil }
        #if os(iOS)
        guard let img = UIImage(contentsOfFile: url.path) else { return nil }
        #else
        guard let img = NSImage(contentsOf: url) else { return nil }
        #endif
        let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
        cachedArtwork = (book.id, art)
        return art
    }

    // MARK: System events

    @objc private func engineConfigChanged() {
        Task { @MainActor in
            // Output device changed (e.g. connected to the car). Resume cleanly from the current word.
            if self.isPlaying { self.refreshPosition(); self.restart(at: self.position) }
        }
    }

    #if os(iOS)
    @objc private func interruption(_ n: Notification) {
        guard let info = n.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        Task { @MainActor in
            switch type {
            case .began:
                if self.isPlaying { self.pause(); self.resumeAfterInterruption = true }
            case .ended:
                let opts = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
                if self.resumeAfterInterruption && opts.contains(.shouldResume) { self.resume() }
                self.resumeAfterInterruption = false
            @unknown default: break
            }
        }
    }
    private var resumeAfterInterruption = false

    @objc private func routeChange(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if reason == .newDeviceAvailable {
            Task { @MainActor in self.outputConnectedAt = Date() }
        }
        if reason == .oldDeviceUnavailable {
            // Headphones unplugged / left the car: pause, like every audiobook app.
            Task { @MainActor in self.pause() }
        }
    }
    #endif
}

extension Narrator: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        let frame = shared.scheduledIncludingPending
        let gen = shared.generation
        DispatchQueue.main.async { [weak self] in
            self?.markerArrived(range: characterRange, frame: frame, gen: gen)
        }
    }
}

final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    var isSet: Bool { lock.withLock { value } }
    /// Returns true only for the first caller.
    func set() -> Bool { lock.withLock { if value { return false }; value = true; return true } }
}

/// Counters touched from synthesis and audio render threads.
final class SharedCounters: @unchecked Sendable {
    private let lock = NSLock()
    private var _scheduled: Int64 = 0
    private var _pending: Int64 = 0
    private var _played: Int64 = 0
    private var _generation = 0

    var scheduled: Int64 { lock.withLock { _scheduled } }
    var played: Int64 { lock.withLock { _played } }
    var generation: Int { lock.withLock { _generation } }
    /// Frames scheduled plus frames converted but not yet scheduled.
    var scheduledIncludingPending: Int64 { lock.withLock { _scheduled + _pending } }

    func reset(generation: Int) { lock.withLock { _scheduled = 0; _played = 0; _pending = 0; _generation = generation } }
    func setGeneration(_ g: Int) { lock.withLock { _generation = g } }
    func addScheduled(_ f: Int64) { lock.withLock { _scheduled += f } }
    func setPending(_ f: Int64) { lock.withLock { _pending = f } }
    func addPlayed(_ f: Int64, gen: Int) { lock.withLock { if gen == _generation { _played += f } } }
}

/// Resamples synthesizer output to the engine format and batches it into ~50ms buffers.
final class BufferConverter: @unchecked Sendable {
    private let format: AVAudioFormat
    private var converter: AVAudioConverter?
    private var pending: AVAudioPCMBuffer?
    private let batchFrames: AVAudioFrameCount = 2048

    init(to format: AVAudioFormat) { self.format = format }

    /// Returns a batch when enough audio has accumulated.
    func add(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converted = convert(input) else { return nil }
        append(converted)
        if let p = pending, p.frameLength >= batchFrames { pending = nil; return p }
        return nil
    }

    func flush() -> AVAudioPCMBuffer? {
        defer { pending = nil }
        return (pending?.frameLength ?? 0) > 0 ? pending : nil
    }

    func silence(seconds: Double) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(seconds * format.sampleRate)
        guard frames > 0, let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        b.frameLength = frames
        return b
    }

    private func append(_ b: AVAudioPCMBuffer) {
        if pending == nil {
            pending = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: max(batchFrames * 2, b.frameLength * 2))
            pending?.frameLength = 0
        }
        guard let p = pending else { return }
        if p.frameLength + b.frameLength > p.frameCapacity {
            // Grow.
            let bigger = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: (p.frameLength + b.frameLength) * 2)!
            copy(p, into: bigger)
            pending = bigger
        }
        copy(b, into: pending!)
    }

    private func copy(_ src: AVAudioPCMBuffer, into dst: AVAudioPCMBuffer) {
        guard let s = src.floatChannelData, let d = dst.floatChannelData else { return }
        let n = Int(src.frameLength)
        (d[0] + Int(dst.frameLength)).update(from: s[0], count: n)
        dst.frameLength += src.frameLength
    }

    private func convert(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if input.format.sampleRate == format.sampleRate, input.format.commonFormat == .pcmFormatFloat32,
           input.format.channelCount == 1, !input.format.isInterleaved || input.format.channelCount == 1 {
            return input
        }
        if converter == nil || converter!.inputFormat != input.format {
            converter = AVAudioConverter(from: input.format, to: format)
        }
        guard let converter else { return nil }
        let ratio = format.sampleRate / input.format.sampleRate
        let cap = AVAudioFrameCount(Double(input.frameLength) * ratio + 1024)
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return nil }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return input
        }
        return error == nil ? out : nil
    }
}
