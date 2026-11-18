// MeMento: the Me suite's reminder that you can't ignore. Lives in the menu
// bar, asks the Me dashboard every few seconds what should be on screen, and
// when a reminder fires it flashes and covers every display. While the
// reminder's lock time runs, the Mac can't be used for anything else.
//
//   MeMento --demo 8             lock for 8 seconds with a sample reminder (no server)
//   MeMento --demo 8 --windowed  the same in an ordinary window
//   MeMento --demo 8 --windowed --snapshot /tmp/shot   saves shot-locked.png and shot-ask.png
import AppKit
import SwiftUI
import ServiceManagement

// MARK: - Look (the dashboard's dark palette, MeMento amber as the accent)
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
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MeMento")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("config.json")
    }
    static func load() -> Config {
        var c = (try? JSONDecoder().decode(Config.self, from: Data(contentsOf: file))) ?? Config()
        // For testing against a local copy of Me: MEMENTO_URL / MEMENTO_KEY.
        let env = ProcessInfo.processInfo.environment
        if let u = env["MEMENTO_URL"] { c.url = u }
        if let k = env["MEMENTO_KEY"] { c.key = k }
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

// MARK: - The lock screen
final class LockModel: ObservableObject {
    @Published var text = ""
    @Published var remaining: TimeInterval = 0
    @Published var total: TimeInterval = 0
    @Published var locked = true
    @Published var flash = false
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
            Look.amber.opacity(model.flash ? 1 : 0)
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Text("Me").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                        .frame(width: 30, height: 30).background(Look.amber).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text("MeMento").font(.system(size: 17, weight: .semibold)).foregroundColor(model.flash ? .black : Look.text)
                    Spacer()
                }
                Spacer(minLength: 20)
                Text(model.text)
                    .font(.system(size: 68, weight: .bold)).tracking(-1.5)
                    .foregroundColor(model.flash ? .black : Look.text)
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
                        Button { model.onAnswer("snooze") } label: { Text("Not yet · 10 min").frame(width: 190, height: 48) }
                            .buttonStyle(.plain).foregroundColor(Look.text).background(Look.panel).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        Button { model.onAnswer("done") } label: { Text("Done").fontWeight(.semibold).frame(width: 190, height: 48) }
                            .buttonStyle(.plain).foregroundColor(.black).background(Look.amber).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .keyboardShortcut(.defaultAction)
                    }.font(.system(size: 17)).padding(.top, 22).disabled(model.sending)
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
        flashAndChime()
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
    private func flashAndChime() {
        // Three slow pulses (gentle on the eyes, impossible to miss) and a chime with each.
        for i in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.9) { [weak self] in
                guard let self, self.current != nil else { return }
                NSSound(named: "Glass")?.play()
                withAnimation(.easeOut(duration: 0.12)) { self.model.flash = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { withAnimation(.easeIn(duration: 0.4)) { self.model.flash = false } }
            }
        }
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
        model.sending = true; model.problem = ""
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

// MARK: - The menu bar app
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let client = Client()
    let lock = LockController()
    var item: NSStatusItem!
    var upcoming: [Memento] = []
    var status = "Starting…"
    var skew: TimeInterval = 0
    var demo: TimeInterval?
    var dueTimer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--demo") { demo = TimeInterval(args.dropFirst(i + 1).first ?? "") ?? 8 }
        lock.windowed = args.contains("--windowed")

        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "bell.fill", accessibilityDescription: "MeMento")
        let menu = NSMenu(); menu.delegate = self; item.menu = menu

        if let demo {
            let m = Memento(id: "demo", text: "Move the laundry to the dryer", due_at: "", lock_seconds: Int(demo), fired_at: nil)
            lock.answer = { _, _, done in done(true); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApp.terminate(nil) } }
            lock.show(m, skew: 0)
            if let i = args.firstIndex(of: "--snapshot"), let base = args.dropFirst(i + 1).first {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.lock.snapshot(to: base + "-flash.png") }
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.4) { self.lock.snapshot(to: base + "-locked.png") }
                DispatchQueue.main.asyncAfter(deadline: .now() + demo + 1) { self.lock.snapshot(to: base + "-ask.png"); NSApp.terminate(nil) }
            }
            return
        }
        lock.answer = { [weak self] m, action, done in self?.client.answer(m.id, action) { ok in done(ok); if ok { self?.poll() } } }
        // Check in every 30 seconds for new reminders, and again at the exact moment the next one is due.
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.poll() }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.poll() }
        poll()
        if !client.hasKey { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.askForKey() } }
    }

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
        let head = NSMenuItem(title: "MeMento · \(status)", action: nil, keyEquivalent: ""); head.isEnabled = false
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
        menu.addItem(withTitle: "Test Flash (5 seconds)", action: #selector(testFlash), keyEquivalent: "").target = self
        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: ""); login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(withTitle: "Set Key…", action: #selector(askForKey), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit MeMento", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    @objc func testFlash() {
        let m = Memento(id: "test-\(Date().timeIntervalSince1970)", text: "This is what a reminder looks like", due_at: "", lock_seconds: 5, fired_at: nil)
        let real = lock.answer
        lock.answer = { [weak self] _, _, done in done(true); self?.lock.answer = real }
        lock.show(m, skew: 0)
    }
    @objc func toggleLogin() {
        do { if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() } }
        catch { let a = NSAlert(); a.messageText = "Couldn’t change Open at Login"; a.informativeText = "Add MeMento yourself in System Settings → General → Login Items."; a.runModal() }
    }
    @objc func askForKey() {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Connect MeMento to Me"
        a.informativeText = "In Me, open Settings → MeMento, copy the key, and paste it here. It’s stored only on this Mac."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.placeholderString = "MeMento key"
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
