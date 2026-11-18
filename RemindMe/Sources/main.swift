// RemindMe: the Me suite's reminder that you can't ignore (first called MeMento). Lives in the menu
// bar, asks the Me dashboard every few seconds what should be on screen, and
// when a reminder fires it covers every display. While the
// reminder's lock time runs, the Mac can't be used for anything else.
//
//   RemindMe --demo 8             lock for 8 seconds with a sample reminder (no server)
//   RemindMe --demo 8 --windowed  the same in an ordinary window
//   RemindMe --demo 8 --windowed --snapshot /tmp/shot   saves shot-locked.png and shot-ask.png
import AppKit
import SwiftUI
import ServiceManagement

// MARK: - Look (the dashboard's dark palette, RemindMe amber as the accent)
enum Look {
    static let bg = Color(red: 0x0c / 255, green: 0x0c / 255, blue: 0x0d / 255)
    static let panel = Color(red: 0x1c / 255, green: 0x1c / 255, blue: 0x1f / 255)
    static let text = Color(red: 0xec / 255, green: 0xec / 255, blue: 0xee / 255)
    static let muted = Color(red: 0x9c / 255, green: 0x9c / 255, blue: 0xa4 / 255)
    static let faint = Color(red: 0x74 / 255, green: 0x74 / 255, blue: 0x7c / 255)
    static let amber = Color(red: 0xf2 / 255, green: 0xa9 / 255, blue: 0x1e / 255)
}
func log(_ s: String) { if CommandLine.arguments.contains("--verbose") { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) } }
let emergencyPhrase = "I am skipping this reminder"
let maxLock: TimeInterval = 3600   // whatever the server says, never hold the screen longer

// MARK: - Settings (the dashboard's address and this Mac's key)
struct Config: Codable {
    var url = "https://me-omega-green.vercel.app"
    var key = ""
    static var file: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = support.appendingPathComponent("RemindMe")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("config.json")
        // The app was first called MeMento: carry its key over.
        let old = support.appendingPathComponent("MeMento/config.json")
        if !FileManager.default.fileExists(atPath: file.path), FileManager.default.fileExists(atPath: old.path) { try? FileManager.default.copyItem(at: old, to: file) }
        return file
    }
    static func load() -> Config {
        var c = (try? JSONDecoder().decode(Config.self, from: Data(contentsOf: file))) ?? Config()
        // For testing against a local copy of Me: REMINDME_URL / REMINDME_KEY.
        let env = ProcessInfo.processInfo.environment
        if let u = env["REMINDME_URL"] { c.url = u }
        if let k = env["REMINDME_KEY"] { c.key = k }
        return c
    }
    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: Config.file, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Config.file.path)   // the key is private
    }
}

// MARK: - What the dashboard tells us
struct Memento: Decodable, Identifiable, Equatable {
    let id: String
    let text: String
    let due_at: String
    let lock_seconds: Int
    let fired_at: String?
}
struct ServerState: Decodable { let now: String; let active: [Memento]; let upcoming: [Memento] }

func parseDate(_ s: String?) -> Date? {
    guard let s else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

final class Client {
    var config = Config.load()
    var hasKey: Bool { !config.key.isEmpty }
    private func request(_ method: String, body: [String: String]? = nil) -> URLRequest? {
        guard let url = URL(string: config.url + "/api/memento/device") else { return nil }
        var r = URLRequest(url: url, timeoutInterval: 12)
        r.httpMethod = method
        r.setValue("Bearer \(config.key)", forHTTPHeaderField: "Authorization")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        if let body { r.httpBody = try? JSONEncoder().encode(body); r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return r
    }
    /// nil state + false = bad key; nil + true = couldn't reach the server.
    func fetch(_ done: @escaping (ServerState?, _ reachable: Bool, _ keyOK: Bool) -> Void) {
        guard hasKey, let r = request("GET") else { done(nil, true, false); return }
        URLSession.shared.dataTask(with: r) { data, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let state = data.flatMap { try? JSONDecoder().decode(ServerState.self, from: $0) }
            DispatchQueue.main.async { done(code == 200 ? state : nil, code != 0, code != 404 && code != 401) }
        }.resume()
    }
    func answer(_ id: String, _ action: String, _ done: @escaping (Bool) -> Void) {
        guard let r = request("POST", body: ["id": id, "action": action]) else { done(false); return }
        URLSession.shared.dataTask(with: r) { _, resp, _ in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async { done(code == 200) }
        }.resume()
    }
}

// MARK: - Buttons that react the instant you touch them
struct MeButtonStyle: ButtonStyle {
    var primary = false
    var large = false
    func makeBody(configuration: Configuration) -> some View { Face(configuration: configuration, primary: primary, large: large) }
    struct Face: View {
        let configuration: Configuration
        let primary: Bool
        let large: Bool
        @State private var hover = false
        @Environment(\.isEnabled) private var enabled
        var body: some View {
            let pressed = configuration.isPressed
            configuration.label
                .font(.system(size: large ? 17 : 13, weight: primary ? .semibold : .medium))
                .foregroundColor(primary ? .black : Look.text)
                .padding(.horizontal, large ? 0 : 13).frame(height: large ? 48 : 30).frame(minWidth: large ? 190 : 0)
                .background(primary ? Look.amber : (hover ? Color(white: 0.2) : Look.panel))
                .brightness(pressed ? -0.12 : (hover && primary ? 0.06 : 0))
                .clipShape(RoundedRectangle(cornerRadius: large ? 12 : 8, style: .continuous))
                .scaleEffect(pressed ? 0.96 : 1)
                .opacity(enabled ? 1 : 0.5)
                .contentShape(Rectangle())
                .onHover { hover = $0 }
                .animation(.easeOut(duration: 0.08), value: pressed)
                .animation(.easeOut(duration: 0.12), value: hover)
        }
    }
}

// MARK: - The lock screen
final class LockModel: ObservableObject {
    @Published var text = ""
    @Published var remaining: TimeInterval = 0
    @Published var total: TimeInterval = 0
    @Published var locked = true
    @Published var sending = false
    @Published var problem = ""
    @Published var typed = ""
    var onAnswer: (String) -> Void = { _ in }
}

struct LockView: View {
    @ObservedObject var model: LockModel
    let controls: Bool   // only one display takes the typing and the buttons
    @FocusState private var typing: Bool

    var clock: String { let s = max(0, Int(model.remaining.rounded(.up))); return String(format: "%d:%02d", s / 60, s % 60) }
    var body: some View {
        ZStack {
            Look.bg
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Text("Me").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                        .frame(width: 30, height: 30).background(Look.amber).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text("RemindMe").font(.system(size: 17, weight: .semibold)).foregroundColor(Look.text)
                    Spacer()
                }
                Spacer(minLength: 20)
                Text(model.text)
                    .font(.system(size: 68, weight: .bold)).tracking(-1.5)
                    .foregroundColor(Look.text)
                    .multilineTextAlignment(.center).lineLimit(5).minimumScaleFactor(0.4)
                    .frame(maxWidth: 1100)
                Spacer().frame(height: 44)
                if model.locked {
                    ZStack {
                        Circle().stroke(Look.panel, lineWidth: 8)
                        Circle().trim(from: 0, to: model.total > 0 ? max(0, min(1, model.remaining / model.total)) : 0)
                            .stroke(Look.amber, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.25), value: model.remaining)
                        Text(clock).font(.system(size: 40, weight: .semibold).monospacedDigit()).foregroundColor(Look.text)
                    }.frame(width: 170, height: 170)
                    Text("Go do it. Your screen comes back when the time is up.")
                        .font(.system(size: 17)).foregroundColor(Look.muted).padding(.top, 22)
                } else if controls {
                    Text("Did you do it?").font(.system(size: 22, weight: .medium)).foregroundColor(Look.muted)
                    HStack(spacing: 14) {
                        Button("Not yet · 10 min") { model.onAnswer("snooze") }.buttonStyle(MeButtonStyle(large: true))
                        Button("Done") { model.onAnswer("done") }.buttonStyle(MeButtonStyle(primary: true, large: true)).keyboardShortcut(.defaultAction)
                    }.padding(.top, 22)
                    if !model.problem.isEmpty { Text(model.problem).font(.system(size: 14)).foregroundColor(Look.muted).padding(.top, 14) }
                } else {
                    Text("Answer on your main screen.").font(.system(size: 17)).foregroundColor(Look.muted)
                }
                Spacer(minLength: 20)
                if model.locked && controls {
                    VStack(spacing: 8) {
                        Text("Real emergency? Type “\(emergencyPhrase)” to unlock. It’s recorded as skipped.")
                            .font(.system(size: 12)).foregroundColor(Look.faint)
                        TextField("", text: $model.typed).textFieldStyle(.plain).font(.system(size: 13)).foregroundColor(Look.muted)
                            .multilineTextAlignment(.center).frame(width: 300, height: 28)
                            .background(Look.panel.opacity(0.6)).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .focused($typing).disableAutocorrection(true)
                            .onChange(of: model.typed) { _, v in if v.trimmingCharacters(in: .whitespaces).lowercased() == emergencyPhrase.lowercased() { model.onAnswer("skip") } }
                        if !model.problem.isEmpty { Text(model.problem).font(.system(size: 12)).foregroundColor(Look.muted) }
                    }
                }
            }.padding(44)
        }
        .ignoresSafeArea()
        .onAppear { typing = controls }
    }
}

final class LockWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class LockController {
    let model = LockModel()
    private var windows: [NSWindow] = []
    private var timer: Timer?
    private var lockUntil = Date()
    private var kiosk = false
    private(set) var current: Memento?
    var isHolding: Bool { current != nil && model.locked }
    var windowed = false
    var answer: (Memento, String, @escaping (Bool) -> Void) -> Void = { _, _, done in done(true) }

    /// `skew` = server time minus this Mac's time, so every device unlocks together.
    func show(_ m: Memento, skew: TimeInterval) {
        if current?.id == m.id && current?.fired_at == m.fired_at { return }
        close()
        current = m
        let fired = (parseDate(m.fired_at) ?? Date().addingTimeInterval(skew)).addingTimeInterval(-skew)
        let length = min(TimeInterval(m.lock_seconds), maxLock)
        lockUntil = fired.addingTimeInterval(length)
        model.text = m.text; model.total = length; model.typed = ""; model.problem = ""; model.sending = false
        model.remaining = max(0, lockUntil.timeIntervalSinceNow); model.locked = model.remaining > 0
        model.onAnswer = { [weak self] action in self?.send(action) }

        let screens = windowed ? [NSScreen.main].compactMap { $0 } : NSScreen.screens
        for (i, screen) in screens.enumerated() {
            let frame = windowed ? NSRect(x: screen.frame.midX - 560, y: screen.frame.midY - 360, width: 1120, height: 720) : screen.frame
            let w = LockWindow(contentRect: frame, styleMask: windowed ? [.titled] : [.borderless], backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.backgroundColor = .black
            w.contentView = NSHostingView(rootView: LockView(model: model, controls: i == 0))
            if !windowed {
                w.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
                w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
                w.setFrame(screen.frame, display: true)
            }
            windows.append(w)
        }
        hold(model.locked)
        front()
        arrive()
        log("showing “\(m.text)” on \(windows.count) screen(s), locked for \(Int(model.remaining))s")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self, self.current != nil else { return }
            log("active=\(NSApp.isActive) key=\(self.windows.first?.isKeyWindow ?? false) presentation=\(NSApp.currentSystemPresentationOptions.rawValue)")
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tickClock() }
    }

    private func front() {
        NSApp.activate(ignoringOtherApps: true)
        for w in windows.reversed() { w.makeKeyAndOrderFront(nil) }
    }
    // While held, nothing else on the Mac can be reached: no Dock, menu bar,
    // app switching, Force Quit or logging out.
    private func hold(_ on: Bool) {
        guard !windowed, on != kiosk else { return }
        kiosk = on
        NSApp.presentationOptions = on ? [.hideDock, .hideMenuBar, .disableProcessSwitching, .disableForceQuit, .disableSessionTermination, .disableHideApplication, .disableAppleMenu] : []
    }
    // No flashing (William asked for none): the reminder fades in, with one chime.
    private func arrive() {
        NSSound(named: "Glass")?.play()
        for w in windows where !windowed { w.alphaValue = 0; w.animator().alphaValue = 1 }
    }
    private func tickClock() {
        model.remaining = max(0, lockUntil.timeIntervalSinceNow)
        if model.locked {
            if model.remaining <= 0 {
                model.locked = false
                hold(false)
                log("time is up: unlocked")
                NSSound(named: "Hero")?.play()
                front()
            } else if !windowed && (!NSApp.isActive || windows.first?.isKeyWindow == false) { front() }   // nothing gets in front
        }
    }
    private func send(_ action: String) {
        guard let m = current, !model.sending else { return }
        if action != "skip" {
            // Done / Not yet: the screen clears the instant you click. If the answer
            // doesn't reach Me (no internet), the reminder simply comes back.
            close()
            answer(m, action) { _ in }
            return
        }
        // The emergency exit has to be confirmed by Me before the lock lets go.
        model.sending = true; model.problem = "Unlocking…"
        answer(m, action) { [weak self] ok in
            guard let self, self.current?.id == m.id else { return }
            self.model.sending = false
            if ok { self.close() } else { self.model.problem = "Couldn’t reach Me. Check the internet and try again."; self.model.typed = "" }
        }
    }
    /// Saves a picture of the first window (used to check the design).
    func snapshot(to path: String) {
        guard let view = windows.first?.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
    }
    func close() {
        timer?.invalidate(); timer = nil
        hold(false)
        if current != nil { log("closed") }
        for w in windows { w.orderOut(nil); w.close() }
        windows = []; current = nil
    }
}

// MARK: - The window you get when you open RemindMe
final class HomeModel: ObservableObject {
    @Published var status = "Starting…"
    @Published var connected = false
    @Published var upcoming: [Memento] = []
    @Published var openAtLogin = false
    var setKey: () -> Void = {}
    var test: () -> Void = {}
    var toggleLogin: () -> Void = {}
    var quit: () -> Void = {}
}

struct HomeView: View {
    @ObservedObject var model: HomeModel
    static let time: DateFormatter = { let f = DateFormatter(); f.doesRelativeDateFormatting = true; f.dateStyle = .short; f.timeStyle = .short; return f }()
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Text("Me").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                    .frame(width: 30, height: 30).background(Look.amber).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text("RemindMe").font(.system(size: 19, weight: .semibold)).foregroundColor(Look.text)
                Spacer()
                Circle().fill(model.connected ? Color.green : Look.faint).frame(width: 8, height: 8)
                Text(model.status).font(.system(size: 12.5)).foregroundColor(Look.muted)
            }
            Text("RemindMe runs in the background (the bell in the menu bar). Ask Claude to “remind me to…” and it takes over your screens when the time comes. You can close this window.")
                .font(.system(size: 13)).foregroundColor(Look.muted).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 0) {
                Text("COMING UP").font(.system(size: 10.5, weight: .semibold)).foregroundColor(Look.faint).padding(.bottom, 8)
                if model.upcoming.isEmpty {
                    Text("No reminders coming up.").font(.system(size: 13.5)).foregroundColor(Look.muted)
                } else {
                    ForEach(model.upcoming.prefix(6)) { m in
                        HStack(alignment: .firstTextBaseline) {
                            Text(m.text).font(.system(size: 13.5, weight: .medium)).foregroundColor(Look.text).lineLimit(1)
                            Spacer()
                            Text((parseDate(m.due_at).map { HomeView.time.string(from: $0) } ?? "") + (m.lock_seconds > 0 ? " · locks \(max(1, Int((Double(m.lock_seconds) / 60).rounded()))) min" : ""))
                                .font(.system(size: 12)).foregroundColor(Look.muted)
                        }.padding(.vertical, 5)
                    }
                }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Look.panel).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Toggle("Open at Login", isOn: Binding(get: { model.openAtLogin }, set: { _ in model.toggleLogin() }))
                .toggleStyle(.checkbox).font(.system(size: 13)).foregroundColor(Look.text)
            HStack(spacing: 8) {
                Button("Test Lock (5 seconds)") { model.test() }
                Button(model.connected ? "Change Key…" : "Set Key…") { model.setKey() }
                Spacer()
                Button("Quit") { model.quit() }
            }.buttonStyle(MeButtonStyle())
        }
        .padding(22).frame(width: 460).background(Look.bg).preferredColorScheme(.dark)
    }
}

// MARK: - The menu bar app
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let client = Client()
    let lock = LockController()
    var item: NSStatusItem!
    var skew: TimeInterval = 0
    var demo: TimeInterval?
    var dueTimer: Timer?
    let home = HomeModel()
    var homeWindow: NSWindow?
    var status: String = "Starting…" { didSet { home.status = status; home.connected = status == "Connected" } }
    var upcoming: [Memento] = [] { didSet { home.upcoming = upcoming } }

    func applicationDidFinishLaunching(_ n: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--demo") { demo = TimeInterval(args.dropFirst(i + 1).first ?? "") ?? 8 }
        lock.windowed = args.contains("--windowed")

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "bell.fill", accessibilityDescription: "RemindMe")
        let menu = NSMenu(); menu.delegate = self; item.menu = menu

        if let demo {
            let m = Memento(id: "demo", text: "Move the laundry to the dryer", due_at: "", lock_seconds: Int(demo), fired_at: nil)
            lock.answer = { _, _, done in done(true); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApp.terminate(nil) } }
            lock.show(m, skew: 0)
            if let i = args.firstIndex(of: "--snapshot"), let base = args.dropFirst(i + 1).first {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.4) { self.lock.snapshot(to: base + "-locked.png") }
                DispatchQueue.main.asyncAfter(deadline: .now() + demo + 1) { self.lock.snapshot(to: base + "-ask.png"); NSApp.terminate(nil) }
            }
            return
        }
        lock.answer = { [weak self] m, action, done in self?.client.answer(m.id, action) { ok in done(ok); if ok { self?.poll() } } }
        home.setKey = { [weak self] in self?.askForKey() }
        home.test = { [weak self] in self?.testLock() }
        home.toggleLogin = { [weak self] in self?.toggleLogin() }
        home.quit = { NSApp.terminate(nil) }
        home.openAtLogin = SMAppService.mainApp.status == .enabled
        // Show the window when you open the app yourself, but not when it starts by itself at login.
        if !startedAtLogin() { showHome() }
        if let i = args.firstIndex(of: "--home-snapshot"), let path = args.dropFirst(i + 1).first {   // a picture of the window, to check the design
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                if let v = self.homeWindow?.contentView, let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) { v.cacheDisplay(in: v.bounds, to: rep); try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path)) }
                NSApp.terminate(nil)
            }
        }
        // Check in every 30 seconds for new reminders, and again at the exact moment the next one is due.
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.poll() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.poll() }
        poll()
        if !client.hasKey { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.askForKey() } }
    }

    func startedAtLogin() -> Bool {
        guard let e = NSAppleEventManager.shared().currentAppleEvent, e.eventID == kAEOpenApplication else { return false }
        return e.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
    }
    func showHome() {
        if homeWindow == nil {
            let w = NSWindow(contentRect: .zero, styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
            w.title = "RemindMe"; w.titlebarAppearsTransparent = true; w.titleVisibility = .hidden
            w.isReleasedWhenClosed = false; w.backgroundColor = NSColor(red: 0x0c / 255, green: 0x0c / 255, blue: 0x0d / 255, alpha: 1)
            w.contentView = NSHostingView(rootView: HomeView(model: home))
            w.setContentSize(w.contentView!.fittingSize); w.center()
            homeWindow = w
        }
        NSApp.activate(ignoringOtherApps: true)
        homeWindow?.makeKeyAndOrderFront(nil)
    }
    // Opening RemindMe again (Finder, Spotlight, Launchpad) brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { if demo == nil && !lock.isHolding { showHome() }; return false }

    func poll() {
        guard client.hasKey else { status = "Needs its key (Set Key…)"; return }
        client.fetch { [weak self] state, reachable, keyOK in
            guard let self else { return }
            guard let state else { self.status = !reachable ? "Offline: can’t reach Me" : keyOK ? "Me didn’t answer properly" : "That key isn’t right (Set Key…)"; return }
            self.status = "Connected"
            self.upcoming = state.upcoming
            if let now = parseDate(state.now) { self.skew = now.timeIntervalSinceNow }
            self.dueTimer?.invalidate()
            if let next = state.upcoming.compactMap({ parseDate($0.due_at) }).min() {
                let wait = next.addingTimeInterval(-self.skew).timeIntervalSinceNow + 0.4
                if wait < 3600 { self.dueTimer = Timer.scheduledTimer(withTimeInterval: max(0.5, wait), repeats: false) { [weak self] _ in self?.poll() } }
            }
            if let m = state.active.first { self.lock.show(m, skew: self.skew) }
            else if self.lock.current != nil { self.lock.close() }   // answered on another device
        }
    }

    // Quitting is off while a reminder holds the screen.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { lock.isHolding && demo == nil ? .terminateCancel : .terminateNow }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let head = NSMenuItem(title: "RemindMe · \(status)", action: nil, keyEquivalent: ""); head.isEnabled = false
        menu.addItem(head)
        menu.addItem(.separator())
        if upcoming.isEmpty {
            let none = NSMenuItem(title: "No reminders coming up", action: nil, keyEquivalent: ""); none.isEnabled = false
            menu.addItem(none)
        } else {
            let f = DateFormatter(); f.doesRelativeDateFormatting = true; f.dateStyle = .short; f.timeStyle = .short
            for m in upcoming.prefix(8) {
                let when = parseDate(m.due_at).map { f.string(from: $0) } ?? ""
                let mins = m.lock_seconds > 0 ? "  (locks \(max(1, Int((Double(m.lock_seconds) / 60).rounded()))) min)" : ""
                let row = NSMenuItem(title: "\(when)  \(m.text)\(mins)", action: nil, keyEquivalent: ""); row.isEnabled = false
                menu.addItem(row)
            }
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open RemindMe", action: #selector(openHome), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Test Lock (5 seconds)", action: #selector(testLock), keyEquivalent: "").target = self
        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: ""); login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(withTitle: "Set Key…", action: #selector(askForKey), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit RemindMe", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    @objc func openHome() { showHome() }
    @objc func testLock() {
        let m = Memento(id: "test-\(Date().timeIntervalSince1970)", text: "This is what a reminder looks like", due_at: "", lock_seconds: 5, fired_at: nil)
        let real = lock.answer
        lock.answer = { [weak self] _, _, done in done(true); self?.lock.answer = real }
        lock.show(m, skew: 0)
    }
    @objc func toggleLogin() {
        defer { home.openAtLogin = SMAppService.mainApp.status == .enabled }
        do { if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } }
        catch { let a = NSAlert(); a.messageText = "Couldn’t change Open at Login"; a.informativeText = "Add RemindMe yourself in System Settings → General → Login Items."; a.runModal() }
    }
    @objc func askForKey() {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Connect RemindMe to Me"
        a.informativeText = "In Me, open Settings → RemindMe, copy the key, and paste it here. It’s stored only on this Mac."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.placeholderString = "RemindMe key"
        a.accessoryView = field
        a.addButton(withTitle: "Connect"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = field
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let key = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        client.config.key = key; client.config.save()
        status = "Connecting…"
        poll()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu bar only: no Dock icon
app.run()
