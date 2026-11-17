import SwiftUI
#if os(iOS)
import UIKit
import UniformTypeIdentifiers
#endif

/// Dark-first palette used everywhere except the reader page itself (which follows its theme).
enum Palette {
    static let bg = Color(red: 0.035, green: 0.035, blue: 0.045)
    static let surface = Color(red: 0.085, green: 0.085, blue: 0.10)
    static let surfaceHi = Color(red: 0.13, green: 0.13, blue: 0.15)
    static let stroke = Color.white.opacity(0.07)
    static let text = Color(red: 0.93, green: 0.93, blue: 0.95)
    static let secondary = Color.white.opacity(0.56)
    static let tertiary = Color.white.opacity(0.32)
    static let accent = Color(red: 0.98, green: 0.66, blue: 0.28)
    static let live = Color(red: 0.35, green: 0.87, blue: 0.62)
    static let warn = Color(red: 1.0, green: 0.6, blue: 0.3)
}

/// The book's cover, blurred into a dark ambient glow. Used behind the hero card and player.
struct AmbientBackground: View {
    let book: Book
    var intensity: Double = 1
    var body: some View {
        ZStack {
            Palette.bg
            CoverImage(book: book)
                .scaledToFill()
                .blur(radius: 60)
                .saturation(1.4)
                .opacity(0.55 * intensity)
                .clipped()
            LinearGradient(colors: [.clear, Palette.bg.opacity(0.65), Palette.bg],
                           startPoint: .top, endPoint: .bottom)
        }
        .allowsHitTesting(false)
    }
}

/// Thin rounded progress bar.
struct ProgressLine: View {
    var value: Double
    var tint: Color = Palette.accent
    var height: CGFloat = 3
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.12))
                Capsule().fill(tint).frame(width: max(height, g.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: height)
        .animation(.smooth(duration: 0.4), value: value)
    }
}

/// Small animated "speaking" bars shown next to whatever is currently playing.
struct LiveBars: View {
    var active: Bool
    var color: Color = Palette.accent
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20, paused: !active)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<4) { i in
                    let h = active ? 0.35 + 0.65 * abs(sin(t * (3.1 + Double(i) * 0.9) + Double(i))) : 0.3
                    Capsule().fill(color).frame(width: 3, height: 14 * h)
                }
            }
            .frame(height: 14, alignment: .bottom)
        }
    }
}

// MARK: - Sync status

enum SyncState: Equatable {
    case off, syncing, synced(Date), error(String)
}

extension AppModel {
    var syncState: SyncState {
        if !progress.sync.isConfigured { return .off }
        if isSyncing { return .syncing }
        if let e = progress.syncError { return .error(e) }
        let last = [progress.lastSyncedAt, progress.lastPushAt].compactMap { $0 }.max()
        return last.map { .synced($0) } ?? .syncing
    }
}

func relativeShort(_ d: Date, now: Date = Date()) -> String {
    let s = now.timeIntervalSince(d)
    if s < 10 { return "just now" }
    if s < 60 { return "\(Int(s))s ago" }
    if s < 3600 { return "\(Int(s / 60))m ago" }
    if s < 86400 { return "\(Int(s / 3600))h ago" }
    return d.formatted(date: .abbreviated, time: .omitted)
}

func deviceSymbol(_ name: String) -> String {
    let n = name.lowercased()
    if n.contains("iphone") { return "iphone" }
    if n.contains("ipad") { return "ipad" }
    return "laptopcomputer"
}

/// Compact live indicator: spinning while syncing, a soft pulse each time it succeeds.
struct SyncPill: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var progress: ProgressStore
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            TimelineView(.periodic(from: .now, by: 5)) { ctx in
                HStack(spacing: 6) {
                    icon
                    Text(label(now: ctx.date))
                        .font(.caption.weight(.semibold))
                        .contentTransition(.numericText())
                        .lineLimit(1)
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Palette.surfaceHi.opacity(0.9), in: Capsule())
                .overlay(Capsule().stroke(tint.opacity(0.35), lineWidth: 1))
                .foregroundStyle(tint)
                .animation(.smooth, value: app.syncState)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sync status")
    }

    @ViewBuilder private var icon: some View {
        switch app.syncState {
        case .off: Image(systemName: "icloud.slash")
        case .syncing: Image(systemName: "arrow.triangle.2.circlepath").symbolEffect(.rotate, options: .repeating, isActive: true)
        case .synced: Image(systemName: "checkmark.icloud.fill").symbolEffect(.bounce, value: progress.lastPushAt)
        case .error: Image(systemName: "exclamationmark.icloud.fill")
        }
    }

    private var tint: Color {
        switch app.syncState {
        case .off: return Palette.secondary
        case .syncing: return Palette.accent
        case .synced: return Palette.live
        case .error: return Palette.warn
        }
    }

    private func label(now: Date) -> String {
        switch app.syncState {
        case .off: return "Sync off"
        case .syncing: return "Syncing"
        case .synced(let d): return "Synced · \(relativeShort(d, now: now))"
        case .error: return "Sync issue"
        }
    }
}

/// Banner that slides in when another device's position is picked up.
struct HandoffToast: View {
    @EnvironmentObject var progress: ProgressStore
    @EnvironmentObject var library: Library
    @State private var shown: (device: String, title: String, chapter: String)?
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        VStack {
            if let shown {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Palette.live.opacity(0.18)).frame(width: 36, height: 36)
                        Image(systemName: deviceSymbol(shown.device)).foregroundStyle(Palette.live)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Picked up from \(shown.device)").font(.subheadline.weight(.semibold))
                        Text("\(shown.title) · \(shown.chapter)").font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Palette.live.opacity(0.3)))
                .shadow(color: .black.opacity(0.4), radius: 20, y: 8)
                .frame(maxWidth: 460)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.95)))
                .onTapGesture { withAnimation(.snappy) { self.shown = nil } }
            }
            Spacer()
        }
        .padding(.top, 6)
        .onChange(of: progress.lastRemoteJump?.id) { _, _ in present() }
    }

    private func present() {
        guard let jump = progress.lastRemoteJump,
              let book = library.books.first(where: { $0.id == jump.bookID }) else { return }
        let ch = book.chapters[safe: progress.position(for: book.id).chapter]?.title ?? ""
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { shown = (jump.device, book.title, ch) }
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.35)) { shown = nil }
        }
    }
}

/// Full sync details: what's connected, when, and one-tap setup.
struct SyncDetailView: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var progress: ProgressStore
    @State private var pickFolder = false
    @State private var folderName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(stateColor.opacity(0.16)).frame(width: 52, height: 52)
                    Image(systemName: stateSymbol).font(.title2).foregroundStyle(stateColor)
                        .symbolEffect(.rotate, options: .repeating, isActive: app.syncState == .syncing)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(stateTitle).font(.headline)
                    Text(stateSubtitle).font(.footnote).foregroundStyle(Palette.secondary)
                }
            }

            if app.syncState != .off {
                TimelineView(.periodic(from: .now, by: 5)) { ctx in
                    VStack(spacing: 0) {
                        deviceRow(ProgressStore.deviceName + " (this device)", date: progress.lastSyncedAt ?? progress.lastPushAt, now: ctx.date)
                        ForEach(progress.otherDevices.sorted { $0.value > $1.value }, id: \.key) { name, date in
                            Divider().overlay(Palette.stroke)
                            deviceRow(name, date: date, now: ctx.date)
                        }
                        if progress.otherDevices.isEmpty {
                            Divider().overlay(Palette.stroke)
                            Text("Your other devices show up here once they've synced with this version.")
                                .font(.caption).foregroundStyle(Palette.tertiary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 14).padding(.vertical, 11)
                        }
                    }
                    .background(Palette.surfaceHi, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if case .error(let e) = app.syncState {
                    Label(e, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Palette.warn)
                }
                HStack {
                    Button { Task { await app.syncNow() } } label: {
                        Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.borderedProminent).tint(Palette.accent).foregroundStyle(.black)
                    .disabled(app.isSyncing)
                    Spacer()
                    Menu {
                        Button("Change folder…") { pickFolder = true }
                        Button("Stop syncing", role: .destructive) { progress.sync.clear(); refresh() }
                    } label: { Image(systemName: "ellipsis.circle").font(.title3) }
                    .menuStyle(.button).buttonStyle(.plain).foregroundStyle(Palette.secondary)
                }
                if let folderName {
                    Text(folderName).font(.caption).foregroundStyle(Palette.tertiary)
                }
            } else {
                Button { pickFolder = true } label: {
                    Label("Connect iCloud Drive", systemImage: "icloud").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large).tint(Palette.accent).foregroundStyle(.black)
                Text("Choose **iCloud Drive › Narrate** and tap **Open**. You only do this once.")
                    .font(.footnote).foregroundStyle(Palette.secondary)
            }
        }
        .onAppear(perform: refresh)
        .folderPicker(isPresented: $pickFolder) { url in
            do { try progress.sync.setFolder(url); progress.syncError = nil }
            catch { progress.syncError = "Couldn't use that folder: \(error.localizedDescription)" }
            refresh()
            Task { await app.syncNow() }
        }
    }

    private func refresh() { folderName = progress.sync.displayName }

    private func deviceRow(_ name: String, date: Date?, now: Date) -> some View {
        HStack(spacing: 12) {
            Image(systemName: deviceSymbol(name)).frame(width: 22).foregroundStyle(Palette.secondary)
            Text(name).font(.subheadline).lineLimit(1)
            Spacer()
            if let date {
                Circle().fill(now.timeIntervalSince(date) < 300 ? Palette.live : Palette.tertiary).frame(width: 6, height: 6)
                Text(relativeShort(date, now: now)).font(.caption.monospacedDigit()).foregroundStyle(Palette.secondary)
            } else {
                Text("waiting…").font(.caption).foregroundStyle(Palette.tertiary)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }

    private var stateColor: Color {
        switch app.syncState {
        case .off: return Palette.secondary
        case .syncing: return Palette.accent
        case .synced: return Palette.live
        case .error: return Palette.warn
        }
    }
    private var stateSymbol: String {
        switch app.syncState {
        case .off: return "icloud.slash"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .synced: return "checkmark.icloud.fill"
        case .error: return "exclamationmark.icloud.fill"
        }
    }
    private var stateTitle: String {
        switch app.syncState {
        case .off: return "Sync is off"
        case .syncing: return "Syncing…"
        case .synced: return "Everything's in sync"
        case .error: return "Sync needs attention"
        }
    }
    private var stateSubtitle: String {
        switch app.syncState {
        case .off: return "Connect once and your place follows you between iPhone and Mac."
        case .error: return "Your place is still saved on this device."
        default: return "Your place and your books follow you automatically."
        }
    }
}

// MARK: - Folder picker (iOS opens straight into iCloud Drive)

extension View {
    func folderPicker(isPresented: Binding<Bool>, onPick: @escaping (URL) -> Void) -> some View {
        #if os(iOS)
        sheet(isPresented: isPresented) {
            FolderPicker(onPick: onPick).ignoresSafeArea()
        }
        #else
        fileImporter(isPresented: isPresented, allowedContentTypes: [.folder]) { result in
            if case let .success(url) = result { onPick(url) }
        }
        #endif
    }
}

#if os(iOS)
private struct FolderPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.delegate = context.coordinator
        // Hint: start inside iCloud Drive (ideally the Narrate folder the Mac created).
        let cloud = URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        picker.directoryURL = cloud.appendingPathComponent("Narrate", isDirectory: true)
        return picker
    }
    func updateUIViewController(_ vc: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let u = urls.first { onPick(u) }
        }
    }
}
#endif
