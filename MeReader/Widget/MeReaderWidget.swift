import WidgetKit
import SwiftUI
import AppIntents

/// "Continue listening": your current book with a play / pause button.
/// Works on the Home Screen, in StandBy, and on the CarPlay widget screen (iOS 26).
@main
struct MeReaderWidgetBundle: WidgetBundle {
    var body: some Widget { MeReaderWidget() }
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
