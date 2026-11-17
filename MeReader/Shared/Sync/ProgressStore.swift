import Foundation
#if os(iOS)
import UIKit
#endif

/// Keeps the one-and-only reading/listening position per book.
/// Saved locally on every change and mirrored to a shared folder (e.g. iCloud Drive) so
/// your Mac and iPhone pick up where the other left off.
@MainActor
final class ProgressStore: ObservableObject {
    @Published private(set) var records: [String: ProgressRecord] = [:]
    /// Set when a newer position arrives from another device (shown as a toast).
    @Published var lastRemoteJump: RemoteJump?

    let sync = SyncFolder()
    private let fileURL: URL
    private var pushTasks: [String: Task<Void, Never>] = [:]

    /// Stable per-install ID, so two devices with the same name don't collide.
    static let deviceID: String = {
        if let id = UserDefaults.standard.string(forKey: "deviceID") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "deviceID")
        return id
    }()

    static var deviceName: String {
        #if os(iOS)
        return UIDevice.current.model // "iPhone" / "iPad"
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = support.appendingPathComponent("Narrate", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("progress.json")
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder.iso.decode([String: ProgressRecord].self, from: data) {
            records = decoded
        }
    }

    func position(for bookID: String) -> Position {
        records[bookID]?.position ?? .start
    }

    /// Records a new position. `pushNow` forces an immediate write to the sync folder (pause, backgrounding).
    func update(_ bookID: String, _ position: Position, pushNow: Bool = false) {
        if records[bookID]?.position == position && !pushNow { return }
        let rec = ProgressRecord(bookID: bookID, position: position, updatedAt: Date(), device: Self.deviceName)
        records[bookID] = rec
        saveLocal()
        pushTasks[bookID]?.cancel()
        let sync = self.sync
        pushTasks[bookID] = Task { [weak self, rec] in
            if !pushNow { try? await Task.sleep(nanoseconds: 4_000_000_000) }
            guard !Task.isCancelled, sync.isConfigured else { return }
            let err = await sync.write(rec)
            guard let self else { return }
            if let err { self.syncError = err } else { self.lastPushAt = Date(); self.syncError = nil }
        }
    }

    func flushAll() {
        for (id, rec) in records where pushTasks[id] != nil {
            pushTasks[id]?.cancel(); pushTasks[id] = nil
            let sync = self.sync
            Task { await sync.write(rec) }
        }
    }

    /// Shown in Settings so sync problems aren't invisible.
    @Published var syncStatus: String?
    @Published var syncError: String?
    @Published private(set) var lastSyncedAt: Date?
    /// Last time this device's position was uploaded.
    @Published private(set) var lastPushAt: Date?
    /// Other devices seen in the sync folder, with the last time each saved a position.
    @Published private(set) var otherDevices: [String: Date] = [:]

    /// Two-way sync of positions: adopts newer remote ones and uploads any local ones the
    /// folder is missing or has older. Returns IDs of books whose position changed here.
    @discardableResult
    func syncPositions() async -> [String] {
        guard sync.isConfigured else { return [] }
        let (remote, readError) = await sync.readAll()
        var errors: [String] = readError.map { [$0] } ?? []
        let remoteByID = Dictionary(remote.map { ($0.bookID, $0) }, uniquingKeysWith: { $0.updatedAt > $1.updatedAt ? $0 : $1 })
        var changed: [String] = []
        for rec in remoteByID.values {
            let local = records[rec.bookID]
            if local == nil || rec.updatedAt > local!.updatedAt.addingTimeInterval(1), rec.position != local?.position {
                records[rec.bookID] = rec
                changed.append(rec.bookID)
                if rec.device != Self.deviceName { lastRemoteJump = RemoteJump(bookID: rec.bookID, device: rec.device) }
            }
        }
        if !changed.isEmpty { saveLocal() }
        var uploaded = 0
        if readError == nil {
            for rec in records.values where (remoteByID[rec.bookID]?.updatedAt ?? .distantPast) < rec.updatedAt.addingTimeInterval(-1) {
                if let e = await sync.write(rec) { errors.append(e) } else { uploaded += 1 }
            }
        }
        syncError = errors.first
        lastSyncedAt = Date()
        if uploaded > 0 { lastPushAt = Date() }
        if readError == nil {
            _ = await sync.writeBeat(DeviceBeat(id: Self.deviceID, name: Self.deviceName, lastSync: Date()))
            let beats = await sync.readBeats()
            var others: [String: Date] = [:]
            for b in beats where b.id != Self.deviceID {
                others[b.name] = max(others[b.name] ?? .distantPast, b.lastSync)
            }
            otherDevices = others
        }
        let time = Date().formatted(date: .omitted, time: .shortened)
        syncStatus = "Last synced \(time) · \(remote.count) position\(remote.count == 1 ? "" : "s") in folder"
            + (uploaded > 0 ? ", \(uploaded) uploaded" : "")
        return changed
    }

    private func saveLocal() {
        if let data = try? JSONEncoder.iso.encode(records) { try? data.write(to: fileURL, options: .atomic) }
    }
}

/// One small file per device in <folder>/Devices, rewritten on every sync, so each device can
/// show when the others last synced (independent of which device last moved your place).
struct DeviceBeat: Codable {
    var id: String
    var name: String
    var lastSync: Date
}

/// A position adopted from another device. `id` changes every time, so views react to every jump.
struct RemoteJump: Equatable {
    let id = UUID()
    let bookID: String
    let device: String
}

extension JSONEncoder {
    static let iso: JSONEncoder = { let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; e.outputFormatting = .prettyPrinted; return e }()
}
extension JSONDecoder {
    static let iso: JSONDecoder = { let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d }()
}

/// A user-chosen folder (ideally in iCloud Drive) shared by all devices.
/// Layout:  <folder>/Progress/<bookID>.json   and   <folder>/Books/*.epub
/// Works with a free Apple developer account (no iCloud entitlement needed) because the
/// folder is accessed through the system file picker + a security-scoped bookmark.
final class SyncFolder: @unchecked Sendable {
    private let bookmarkKey = "syncFolderBookmark"
    private let queue = DispatchQueue(label: "narrate.sync")

    var isConfigured: Bool { resolve() != nil }

    var displayName: String? {
        guard let url = resolve() else { return nil }
        let path = url.path
        if let r = path.range(of: "com~apple~CloudDocs") { return "iCloud Drive" + path[r.upperBound...] }
        return url.lastPathComponent
    }

    func setFolder(_ url: URL) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        #if os(macOS)
        let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
        UserDefaults.standard.set(data, forKey: bookmarkKey)
    }

    func clear() { UserDefaults.standard.removeObject(forKey: bookmarkKey) }

    #if os(macOS)
    /// On the Mac (unsandboxed) we can default to ~/iCloud Drive/Narrate automatically.
    func configureDefaultIfNeeded() {
        guard !isConfigured else { return }
        let cloud = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        guard FileManager.default.fileExists(atPath: cloud.path) else { return }
        let folder = cloud.appendingPathComponent("Narrate", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? setFolder(folder)
    }
    #endif

    func resolve() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale { try? setFolder(url) }
        return url
    }

    /// Runs `body` with access to the folder, off the main thread.
    func withFolder<T>(_ body: @escaping (URL) -> T?) async -> T? {
        guard let url = resolve() else { return nil }
        return await withCheckedContinuation { cont in
            queue.async {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                cont.resume(returning: body(url))
            }
        }
    }

    /// Writes one position file. Returns an error message on failure.
    @discardableResult
    func write(_ rec: ProgressRecord) async -> String? {
        await withFolder { folder -> String? in
            let dir = folder.appendingPathComponent("Progress", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let data = try JSONEncoder.iso.encode(rec)
                return Self.coordinatedWrite(data, to: dir.appendingPathComponent("\(rec.bookID).json"))
            } catch { return "Saving progress: \(error.localizedDescription)" }
        } ?? "Sync folder is not accessible. Choose it again in Settings."
    }

    /// Writes without `.atomic`: an atomic write needs a temporary file next to the target,
    /// which a sandboxed iPhone app often isn't allowed to create inside iCloud Drive.
    /// The file coordinator already protects against half-written files.
    private static func coordinatedWrite(_ data: Data, to file: URL) -> String? {
        var coordErr: NSError?
        var writeErr: Error?
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &coordErr) { url in
            do { try data.write(to: url) } catch { writeErr = error }
        }
        if let e = coordErr ?? writeErr { return "Writing \(file.lastPathComponent): \(e.localizedDescription)" }
        return nil
    }

    /// Lists a folder in the sync folder, asking iCloud for fresh contents first.
    /// Returns real file names (iCloud ".name.icloud" placeholders are mapped back and downloaded).
    private static func list(_ dir: URL) -> [URL] {
        let fm = FileManager.default
        try? fm.startDownloadingUbiquitousItem(at: dir)
        var items: [URL] = []
        var err: NSError?
        // A coordinated read of the folder makes iCloud Drive refresh its listing on iOS.
        NSFileCoordinator().coordinate(readingItemAt: dir, options: [], error: &err) { url in
            items = (try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)) ?? []
        }
        return items.compactMap { item in
            let name = item.lastPathComponent
            if name.hasPrefix("."), item.pathExtension == "icloud" {
                try? fm.startDownloadingUbiquitousItem(at: item)
                return dir.appendingPathComponent(String(item.deletingPathExtension().lastPathComponent.dropFirst()))
            }
            if name.hasPrefix(".") { return nil }
            try? fm.startDownloadingUbiquitousItem(at: item)
            return dir.appendingPathComponent(name)
        }
    }

    func readAll() async -> (records: [ProgressRecord], error: String?) {
        await withFolder { folder -> ([ProgressRecord], String?) in
            let dir = folder.appendingPathComponent("Progress", isDirectory: true)
            var out: [ProgressRecord] = []
            for target in Self.list(dir) where target.pathExtension == "json" {
                var err: NSError?
                NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &err) { url in
                    if let data = try? Data(contentsOf: url), let rec = try? JSONDecoder.iso.decode(ProgressRecord.self, from: data) {
                        out.append(rec)
                    }
                }
            }
            return (out, nil)
        } ?? ([], "Sync folder is not accessible. Choose it again in Settings.")
    }

    @discardableResult
    func writeBeat(_ beat: DeviceBeat) async -> String? {
        await withFolder { folder -> String? in
            let dir = folder.appendingPathComponent("Devices", isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                return Self.coordinatedWrite(try JSONEncoder.iso.encode(beat), to: dir.appendingPathComponent("\(beat.id).json"))
            } catch { return error.localizedDescription }
        } ?? "Sync folder is not accessible."
    }

    func readBeats() async -> [DeviceBeat] {
        await withFolder { folder -> [DeviceBeat] in
            let dir = folder.appendingPathComponent("Devices", isDirectory: true)
            var out: [DeviceBeat] = []
            for f in Self.list(dir) where f.pathExtension == "json" {
                var err: NSError?
                NSFileCoordinator().coordinate(readingItemAt: f, options: [], error: &err) { url in
                    if let d = try? Data(contentsOf: url), let b = try? JSONDecoder.iso.decode(DeviceBeat.self, from: d) { out.append(b) }
                }
            }
            return out
        } ?? []
    }

    /// Copies an EPUB into <folder>/Books/<name> so other devices can import it.
    func shareBook(_ source: URL, as name: String) async -> String? {
        await withFolder { folder -> String? in
            let fm = FileManager.default
            let dir = folder.appendingPathComponent("Books", isDirectory: true)
            do { try fm.createDirectory(at: dir, withIntermediateDirectories: true) }
            catch { return "Creating Books folder: \(error.localizedDescription)" }
            let dest = dir.appendingPathComponent(name)
            if fm.fileExists(atPath: dest.path) { return nil }
            var coordErr: NSError?
            var copyErr: Error?
            NSFileCoordinator().coordinate(writingItemAt: dest, options: .forReplacing, error: &coordErr) { dst in
                do { try fm.copyItem(at: source, to: dst) } catch { copyErr = error }
            }
            if let e = coordErr ?? copyErr { return "Uploading \(name): \(e.localizedDescription)" }
            return nil
        } ?? "Sync folder is not accessible. Choose it again in Settings."
    }

    /// Copies the chapters the Mac prepared (<folder>/Audio/<bookID>) for `chapters` into `dest`,
    /// so they play offline. Deletes local chapters outside that range. Returns how many of
    /// `chapters` are now on this device.
    func fetchAudio(bookID: String, chapters: Range<Int>, into dest: URL) async -> Int {
        await withFolder { folder -> Int in
            let fm = FileManager.default
            let dir = folder.appendingPathComponent("Audio/\(bookID)", isDirectory: true)
            try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
            // Old chapters you've moved past.
            for f in (try? fm.contentsOfDirectory(at: dest, includingPropertiesForKeys: nil)) ?? [] {
                if let n = Int(f.deletingPathExtension().lastPathComponent), !chapters.contains(n) { try? fm.removeItem(at: f) }
            }
            guard fm.fileExists(atPath: dir.path) else { return 0 }
            let remote = Set(Self.list(dir).map(\.lastPathComponent))   // also asks iCloud to download them
            var have = 0
            for c in chapters {
                let local = dest.appendingPathComponent("\(c).json")
                guard remote.contains("\(c).json"), remote.contains("\(c).m4a") else {
                    if fm.fileExists(atPath: local.path) { have += 1 }
                    continue
                }
                let json = dir.appendingPathComponent("\(c).json"), audio = dir.appendingPathComponent("\(c).m4a")
                var manifest: Data?
                var err: NSError?
                NSFileCoordinator().coordinate(readingItemAt: json, options: [], error: &err) { manifest = try? Data(contentsOf: $0) }
                guard let manifest, let m = try? JSONDecoder.iso.decode(RenderedChapter.self, from: manifest) else {
                    if fm.fileExists(atPath: local.path) { have += 1 }
                    continue
                }
                if (try? Data(contentsOf: local)) == manifest { have += 1; continue }
                // Only copy once iCloud has the matching audio file fully downloaded.
                let size = (try? fm.attributesOfItem(atPath: audio.path)[.size] as? NSNumber)?.intValue
                guard let size, m.audioBytes == nil || m.audioBytes == size else {
                    if fm.fileExists(atPath: local.path) { have += 1 }
                    continue
                }
                let tmp = dest.appendingPathComponent(".\(c)-\(UUID().uuidString).m4a")
                var copied = false
                NSFileCoordinator().coordinate(readingItemAt: audio, options: [], error: &err) { src in
                    copied = (try? fm.copyItem(at: src, to: tmp)) != nil
                }
                guard copied else { try? fm.removeItem(at: tmp); continue }
                let target = dest.appendingPathComponent("\(c).m4a")
                try? fm.removeItem(at: local)
                try? fm.removeItem(at: target)
                guard (try? fm.moveItem(at: tmp, to: target)) != nil,
                      (try? manifest.write(to: local, options: .atomic)) != nil else { continue }
                have += 1
            }
            return have
        } ?? 0
    }

    /// EPUBs present in <folder>/Books.
    func sharedBooks() async -> [URL] {
        await withFolder { folder -> [URL] in
            Self.list(folder.appendingPathComponent("Books", isDirectory: true))
                .filter { $0.pathExtension.lowercased() == "epub" }
        } ?? []
    }
}
