import WidgetKit
import SwiftUI
import AppIntents

/// "Continue listening": your current book with a play / pause button.
/// Works on the Home Screen, in StandBy, and on the CarPlay widget screen (iOS 26).
@main
struct MeReaderWidgetBundle: WidgetBundle {
    var body: some Widget {
        MeReaderWidget()
        MeReaderControlsWidget()
    }
}

struct MeReaderWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshot.kind, provider: Provider()) { entry in
            WidgetView(entry: entry)
                .containerBackground(for: .widget) { Color(hex: 0x0c0c0d) }
        }
        .configurationDisplayName("Continue listening")
        .description("Your current book, with play and pause.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let cover: UIImage?
}

struct Provider: TimelineProvider {
    private func entry() -> Entry {
        Entry(date: Date(), snapshot: WidgetSnapshot.load(),
              cover: WidgetSnapshot.coverURL.flatMap { UIImage(contentsOfFile: $0.path) })
    }
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snapshot: WidgetSnapshot(bookTitle: "Your book", chapterTitle: "Chapter 1", detail: "", isPlaying: false), cover: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [entry()], policy: .never))   // the app reloads it when something changes
    }
}

private let accent = Color(hex: 0x5b8def)
private let muted = Color(hex: 0x9c9ca4)

struct WidgetView: View {
    let entry: Entry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.snapshot {
            if family == .systemMedium { medium(s) } else { small(s) }
        } else {
            VStack(spacing: 8) {
                MeMark(size: 28)
                Text("Open MeReader and add a book").font(.caption).foregroundStyle(muted).multilineTextAlignment(.center)
            }
        }
    }

    private func small(_ s: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                cover.frame(width: 44, height: 62)
                Spacer()
                playButton(s, size: 50)
            }
            Spacer(minLength: 6)
            Text(s.bookTitle).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
            Text(s.chapterTitle).font(.system(size: 12)).foregroundStyle(muted).lineLimit(2)
        }
    }

    private func medium(_ s: WidgetSnapshot) -> some View {
        HStack(spacing: 14) {
            cover.frame(width: 76, height: 108)
            VStack(alignment: .leading, spacing: 3) {
                Text(s.isPlaying ? "NOW PLAYING" : "CONTINUE").font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundStyle(accent)
                Text(s.bookTitle).font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Text(s.chapterTitle).font(.system(size: 13)).foregroundStyle(muted).lineLimit(2)
                Spacer(minLength: 0)
                Text(s.detail).font(.system(size: 11)).foregroundStyle(muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            playButton(s, size: 56)
        }
    }

    @ViewBuilder private var cover: some View {
        if let img = entry.cover {
            Image(uiImage: img).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color(hex: 0x1c1c1f))
                .overlay(Image(systemName: "book.closed.fill").foregroundStyle(muted))
        }
    }

    private func playButton(_ s: WidgetSnapshot, size: CGFloat) -> some View {
        Button(intent: TogglePlaybackIntent()) {
            Image(systemName: s.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(accent, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(s.isPlaying ? "Pause" : "Play")
    }
}

struct MeMark: View {
    var size: CGFloat = 24
    var body: some View {
        Text("Me").font(.system(size: size * 0.46, weight: .bold)).foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(accent, in: RoundedRectangle(cornerRadius: size * 0.29, style: .continuous))
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}

/// Speed down / up and "next book". A separate small widget, so it also fits the CarPlay widget screen.
struct MeReaderControlsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshot.controlsKind, provider: Provider()) { entry in
            ControlsView(snapshot: entry.snapshot)
                .containerBackground(for: .widget) { Color(hex: 0x0c0c0d) }
        }
        .configurationDisplayName("Speed and book")
        .description("Change the narration speed, or switch to your next book.")
        .supportedFamilies([.systemSmall])
    }
}

struct ControlsView: View {
    let snapshot: WidgetSnapshot?

    private var rateText: String {
        let r = snapshot?.rate ?? 1
        return (r == r.rounded() ? String(Int(r)) : String(format: "%g", r)) + "×"
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 0) {
                step("minus", "Slower", SlowerIntent())
                Text(rateText)
                    .font(.system(size: 22, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .contentTransition(.numericText())
                step("plus", "Faster", FasterIntent())
            }
            Button(intent: NextBookIntent()) {
                HStack(spacing: 6) {
                    Image(systemName: "forward.end.fill").font(.system(size: 12, weight: .bold))
                    Text(snapshot?.nextBookTitle ?? "Only one book")
                        .font(.system(size: 13, weight: .medium)).lineLimit(1)
                }
                .foregroundStyle(snapshot?.nextBookTitle == nil ? muted : .white)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Color(hex: 0x1c1c1f), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(snapshot?.nextBookTitle == nil)
            .accessibilityLabel("Next book" + (snapshot?.nextBookTitle.map { ": \($0)" } ?? ""))
        }
    }

    private func step(_ symbol: String, _ label: String, _ intent: some AppIntent) -> some View {
        Button(intent: intent) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(accent, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
