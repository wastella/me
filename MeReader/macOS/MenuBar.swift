import SwiftUI
import AppKit

/// MeReader on the Mac lives in the menu bar: it keeps syncing and preparing audio in the
/// background and never shows a Dock icon (LSUIElement). The library opens from the menu bar.
final class MacAppDelegate: NSObject, NSApplicationDelegate {
    private var launchedAtLogin = false
    private var syncLoop: Task<Void, Never>?

    func applicationWillFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        launchedAtLogin = event?.eventID == kAEOpenApplication
            && event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            AudioRenderer.shared.start()
            // Pull positions from the iPhone regularly, window or not, so the audio being
            // prepared follows wherever you are in the book.
            syncLoop = Task { @MainActor in
                while !Task.isCancelled {
                    await AppModel.shared.syncNow()
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                }
            }
        }
        if launchedAtLogin {
            // Started by logging in: work quietly in the menu bar instead of opening the library.
            DispatchQueue.main.async {
                for w in NSApp.windows where Self.isLibraryWindow(w) { w.close() }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    static func isLibraryWindow(_ w: NSWindow) -> Bool {
        w.styleMask.contains(.titled) && !(w is NSPanel) && w.canBecomeMain
    }

    /// Opens (or brings back) the library window.
    @MainActor static func showLibrary(_ openWindow: OpenWindowAction) {
        if let w = NSApp.windows.first(where: isLibraryWindow) {
            w.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: "library")
        }
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// The menu bar icon: a waveform, filled while audio is being prepared.
struct MenuBarIcon: View {
    @ObservedObject var renderer = AudioRenderer.shared
    var body: some View {
        Image(systemName: renderer.current != nil ? "waveform.circle.fill" : "waveform.circle")
    }
}

/// The panel under the menu bar icon.
struct MenuBarPanel: View {
    @ObservedObject private var renderer = AudioRenderer.shared
    @ObservedObject private var app = AppModel.shared
    @ObservedObject private var narrator = AppModel.shared.narrator
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("MeReader").font(.headline)
                Spacer()
                SyncPill { MacAppDelegate.showLibrary(openWindow) }
            }

            if let book = narrator.book {
                HStack(spacing: 10) {
                    Button { narrator.toggle() } label: {
                        Image(systemName: narrator.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 28)).foregroundStyle(Palette.accent)
                    }
                    .buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(book.title).font(.callout.weight(.medium)).lineLimit(1)
                        Text(book.chapters[safe: narrator.position.chapter]?.title ?? "")
                            .font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                if !renderer.enabled {
                    Label("Preparing audio is paused", systemImage: "pause.circle").font(.callout)
                } else if let w = renderer.current {
                    HStack(spacing: 6) {
                        LiveBars(active: true).frame(width: 14, height: 11)
                        Text("Preparing \(w.title), ch. \(w.chapter + 1)").font(.callout).lineLimit(1)
                        Spacer()
                        Text("\(Int(w.fraction * 100))%").font(.caption.monospacedDigit()).foregroundStyle(Palette.secondary)
                    }
                    ProgressLine(value: w.fraction)
                } else {
                    Label("All caught up", systemImage: "checkmark.circle").font(.callout).foregroundStyle(Palette.live)
                }
                ForEach(app.library.books.filter { renderer.ready[$0.id] != nil }, id: \.id) { book in
                    let r = renderer.ready[book.id]!
                    Text("\(book.title): \(r.chapters) ch. ready · \(String(format: "%.1f", r.hours)) h")
                        .font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
                }
                if let e = renderer.error {
                    Text(e).font(.caption).foregroundStyle(Palette.warn).fixedSize(horizontal: false, vertical: true)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 2) {
                Toggle("Prepare audio in the background", isOn: $renderer.enabled).toggleStyle(.checkbox)
                Toggle("Open at login", isOn: $renderer.openAtLogin).toggleStyle(.checkbox)
            }
            .font(.callout)

            HStack {
                Button("Open Library") { MacAppDelegate.showLibrary(openWindow) }
                    .keyboardShortcut("o")
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
                    .keyboardShortcut("q")
            }
        }
        .padding(14)
        .frame(width: 300)
        .environmentObject(app)
        .environmentObject(app.progress)
        .environmentObject(app.narrator)
        .environmentObject(app.library)
    }
}
