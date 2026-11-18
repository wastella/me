import SwiftUI

/// Floating bar: what's playing, play/pause, +15. Tap it for the full player.
struct MiniPlayer: View {
    var book: Book? = nil
    var onOpen: () -> Void
    @EnvironmentObject var narrator: Narrator
    @EnvironmentObject var progress: ProgressStore

    private var target: Book? { book ?? narrator.book }
    private var isThis: Bool { narrator.book?.id == target?.id }
    private var playing: Bool { isThis && narrator.isPlaying }

    var body: some View {
        if let target {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button(action: onOpen) {
                        HStack(spacing: 12) {
                            CoverImage(book: target)
                                .frame(width: 40, height: 40)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(chapterTitle(target)).font(.subheadline.weight(.semibold)).lineLimit(1)
                                HStack(spacing: 6) {
                                    if playing { LiveBars(active: !narrator.isBuffering).scaleEffect(0.7, anchor: .leading).frame(width: 14) }
                                    Text(subtitle(target)).font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
                                        .contentTransition(.opacity)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Button {
                        if isThis { narrator.toggle() } else { narrator.play(target) }
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.title3)
                            .contentTransition(.symbolEffect(.replace))
                            .frame(width: 44, height: 44)
                            .background(Palette.accent, in: Circle())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(PressableStyle())
                    .keyboardShortcut(.space, modifiers: [])
                    .sensoryFeedback(.impact(weight: .light), trigger: playing)

                    if isThis {
                        Button { narrator.skip(seconds: 15) } label: {
                            Image(systemName: "goforward.15").font(.title3).frame(width: 36, height: 44)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                if isThis {
                    ProgressLine(value: narrator.chapterFraction, height: 2)
                        .padding(.horizontal, 14).padding(.bottom, 6)
                }
            }
            .foregroundStyle(Palette.text)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Palette.stroke))
            .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .frame(maxWidth: 640)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func chapterTitle(_ b: Book) -> String {
        let ch = isThis ? narrator.position.chapter : progress.position(for: b.id).chapter
        return b.chapters[safe: ch]?.title ?? b.title
    }

    private func subtitle(_ b: Book) -> String {
        if isThis && narrator.isBuffering { return "Preparing voice…" }
        if isThis { return "\(formatDuration(narrator.chapterTimeRemaining)) left · \(speedLabel(narrator.rate))" }
        return "Listen from where you are"
    }
}

/// Buttons that shrink slightly while pressed.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Full-screen player with the cover glow, scrubber and all controls.
struct NowPlayingView: View {
    let book: Book
    var onRead: (() -> Void)? = nil
    @EnvironmentObject var narrator: Narrator
    @EnvironmentObject var progress: ProgressStore
    @EnvironmentObject var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?
    @State private var showSync = false

    private var isThis: Bool { narrator.book?.id == book.id }
    private var playing: Bool { isThis && narrator.isPlaying }
    private var pos: Position { isThis ? narrator.position : progress.position(for: book.id) }

    var body: some View {
        GeometryReader { geo in
            let coverSide = min(geo.size.width - 64, geo.size.height * 0.42, 420)
            VStack(spacing: 0) {
                header
                Spacer(minLength: 12)
                CoverImage(book: book)
                    .frame(width: coverSide * 0.68, height: coverSide)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: .black.opacity(0.6), radius: 30, y: 16)
                    .scaleEffect(playing ? 1 : 0.88)
                    .animation(.spring(response: 0.5, dampingFraction: 0.7), value: playing)
                Spacer(minLength: 16)

                VStack(spacing: 6) {
                    Text(book.chapters[safe: pos.chapter]?.title ?? "")
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.7)
                        .contentTransition(.opacity)
                        .animation(.smooth, value: pos.chapter)
                    Text("\(book.title) · Chapter \(pos.chapter + 1) of \(book.chapters.count)")
                        .font(.subheadline).foregroundStyle(Palette.secondary).lineLimit(1)
                }
                .padding(.horizontal, 24)

                scrubber.padding(.horizontal, 28).padding(.top, 22)
                controls.padding(.top, 14)
                Spacer(minLength: 12)
                bottomRow.padding(.horizontal, 28).padding(.bottom, 12)
            }
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(Palette.text)
        .background(AmbientBackground(book: book).ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSync) {
            SyncDetailView().padding(20)
                .presentationDetents([.medium])
                .presentationBackground(Palette.surface)
                .preferredColorScheme(.dark)
        }
    }

    private var header: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.down").font(.headline.weight(.bold))
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(PressableStyle())
            Spacer()
            SyncPill { showSync = true }
        }
        .padding(.horizontal, 20).padding(.top, 10)
    }

    private var scrubber: some View {
        let value = scrub ?? (isThis ? narrator.chapterFraction : 0)
        let duration = isThis ? narrator.chapterDuration : 0
        return VStack(spacing: 6) {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.14))
                    Capsule().fill(Palette.accent).frame(width: max(6, g.size.width * value))
                    Circle().fill(.white).frame(width: scrub == nil ? 12 : 20, height: scrub == nil ? 12 : 20)
                        .shadow(radius: 4)
                        .offset(x: g.size.width * value - (scrub == nil ? 6 : 10))
                        .animation(.spring(response: 0.25), value: scrub == nil)
                }
                .frame(height: scrub == nil ? 5 : 8)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { v in scrub = max(0, min(1, v.location.x / g.size.width)) }
                    .onEnded { _ in
                        if let s = scrub {
                            if !isThis { narrator.play(book) }
                            narrator.seek(chapterFraction: s)
                        }
                        scrub = nil
                    })
            }
            .frame(height: 24)
            HStack {
                Text(clock(duration * value)).monospacedDigit()
                Spacer()
                Text("−" + clock(duration * (1 - value))).monospacedDigit()
            }
            .font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
        }
        .disabled(!isThis)
        .opacity(isThis ? 1 : 0.4)
    }

    private var controls: some View {
        HStack(spacing: 0) {
            control("backward.end.fill", 22) { ensure(); narrator.previousChapter() }
            control("gobackward.15", 30) { ensure(); narrator.skip(seconds: -15) }
            Button {
                if isThis { narrator.toggle() } else { narrator.play(book) }
            } label: {
                ZStack {
                    Circle().fill(Palette.accent).frame(width: 84, height: 84)
                        .shadow(color: Palette.accent.opacity(playing ? 0.5 : 0.2), radius: playing ? 24 : 10)
                    if isThis && narrator.isBuffering {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 34, weight: .bold)).foregroundStyle(.white)
                            .contentTransition(.symbolEffect(.replace))
                            .offset(x: playing ? 0 : 2)
                    }
                }
            }
            .buttonStyle(PressableStyle())
            .frame(maxWidth: .infinity)
            .sensoryFeedback(.impact(weight: .medium), trigger: playing)
            .keyboardShortcut(.space, modifiers: [])
            control("goforward.15", 30) { ensure(); narrator.skip(seconds: 15) }
            control("forward.end.fill", 22) { ensure(); narrator.nextChapter() }
        }
        .padding(.horizontal, 12)
    }

    private var bottomRow: some View {
        HStack {
            SpeedMenu()
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white.opacity(0.08), in: Capsule())
            Spacer()
            sleepMenu
            Spacer()
            if let onRead {
                pill("book.fill", "Read") { onRead() }
            }
        }
        .font(.subheadline.weight(.semibold))
    }

    private var sleepMenu: some View {
        Menu {
            Button("Off") { narrator.setSleepTimer(minutes: nil) }
            ForEach([15, 30, 45, 60, 90], id: \.self) { m in Button("\(m) minutes") { narrator.setSleepTimer(minutes: m) } }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: narrator.sleepTimerEnd == nil ? "moon" : "moon.fill")
                if let end = narrator.sleepTimerEnd { Text(end, style: .timer).monospacedDigit() }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.white.opacity(narrator.sleepTimerEnd == nil ? 0.08 : 0.18), in: Capsule())
        }
        .menuStyle(.button).buttonStyle(.plain)
    }

    private func pill(_ symbol: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(PressableStyle())
    }

    private func control(_ symbol: String, _ size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 64).contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }

    private func ensure() { if !isThis { narrator.play(book); narrator.pause() } }

    private func clock(_ t: TimeInterval) -> String {
        let s = max(0, Int(t))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

struct SpeedMenu: View {
    @EnvironmentObject var narrator: Narrator
    static let speeds: [Double] = [0.75, 1.0, 1.1, 1.25, 1.4, 1.5, 1.75, 2.0, 2.5]
    var body: some View {
        Menu {
            ForEach(Self.speeds, id: \.self) { s in
                Button { narrator.rate = s } label: {
                    if s == narrator.rate { Label(speedLabel(s), systemImage: "checkmark") } else { Text(speedLabel(s)) }
                }
            }
        } label: {
            Text(speedLabel(narrator.rate)).font(.subheadline.weight(.semibold).monospacedDigit())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .fixedSize()
    }
}

func speedLabel(_ s: Double) -> String {
    s == s.rounded() ? "\(Int(s))×" : String(format: "%g×", s)
}
