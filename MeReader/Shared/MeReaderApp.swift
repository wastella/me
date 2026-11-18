import SwiftUI

@main
struct MeReaderApp: App {
    @StateObject private var app = AppModel.shared
    @Environment(\.scenePhase) private var phase
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var delegate
    #endif

    var body: some Scene {
        WindowGroup(id: "library") {
            LibraryView()
                .overlay { HandoffToast() }
                .preferredColorScheme(.dark)
                .tint(Palette.accent)
                .environmentObject(app)
                .environmentObject(app.library)
                .environmentObject(app.progress)
                .environmentObject(app.narrator)
                .onOpenURL { url in
                    guard url.pathExtension.lowercased() == "epub" else { return }
                    Task { await app.importFiles([url]) }
                }
                .task {
                    #if DEBUG
                    #if os(macOS)
                    if ProcessInfo.processInfo.environment["NARRATE_KOKORO_BENCH"] != nil { KokoroEngine.benchAndExit() }
                    #endif
                    if let p = ProcessInfo.processInfo.environment["NARRATE_IMPORT"] {
                        await app.importFiles([URL(fileURLWithPath: p)])
                    }
                    #endif
                }
                #if os(iOS)
                .task { AppExpiry.scheduleReminders() }
                .task { WidgetBridge.start() }
                #endif
                #if os(iOS)
                // On the Mac this loop runs in the app delegate, so it continues with no window open.
                .task {
                    // Pull positions from other devices regularly while open.
                    while !Task.isCancelled {
                        await app.syncNow()
                        try? await Task.sleep(nanoseconds: 20_000_000_000)
                    }
                }
                #endif
                #if os(macOS)
                .frame(minWidth: 520, minHeight: 600)
                #endif
        }
        .onChange(of: phase) { _, newPhase in
            switch newPhase {
            case .active: Task { await app.syncNow() }
            case .background, .inactive: app.progress.flushAll()
            @unknown default: break
            }
        }
        #if os(macOS)
        .commands {
            CommandMenu("Playback") {
                Button("Play / Pause") { app.narrator.toggle() }.keyboardShortcut("p", modifiers: [.command])
                Button("Back 15 Seconds") { app.narrator.skip(seconds: -15) }.keyboardShortcut(.leftArrow, modifiers: [.command])
                Button("Forward 15 Seconds") { app.narrator.skip(seconds: 15) }.keyboardShortcut(.rightArrow, modifiers: [.command])
                Button("Next Chapter") { app.narrator.nextChapter() }.keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                Button("Previous Chapter") { app.narrator.previousChapter() }.keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            }
        }
        #endif
        #if os(macOS)
        MenuBarExtra {
            MenuBarPanel().preferredColorScheme(.dark).tint(Palette.accent)
        } label: {
            MenuBarIcon()
        }
        .menuBarExtraStyle(.window)
        #endif
    }
}
