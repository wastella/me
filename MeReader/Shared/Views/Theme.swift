import SwiftUI

enum ReaderTheme: String, CaseIterable, Identifiable {
    case light, sepia, dark, black
    var id: String { rawValue }
    var name: String { rawValue.capitalized }

    var background: Color {
        switch self {
        case .light: return Color(red: 1, green: 1, blue: 1)
        case .sepia: return Color(red: 0.97, green: 0.93, blue: 0.85)
        case .dark: return Palette.surface
        case .black: return .black
        }
    }
    var text: Color {
        switch self {
        case .light: return Color(red: 0.1, green: 0.1, blue: 0.1)
        case .sepia: return Color(red: 0.25, green: 0.2, blue: 0.14)
        case .dark: return Color(red: 0.86, green: 0.86, blue: 0.84)
        case .black: return Color(red: 0.75, green: 0.75, blue: 0.73)
        }
    }
    var secondary: Color { text.opacity(0.55) }
    var highlight: Color {
        switch self {
        case .light, .sepia: return Color(hex: 0x2f63c8).opacity(0.24)
        case .dark, .black: return Color(hex: 0x5b8def).opacity(0.42)
        }
    }
    var colorScheme: ColorScheme { self == .light || self == .sepia ? .light : .dark }
}

enum ReaderFont: String, CaseIterable, Identifiable {
    case serif, sans, rounded
    var id: String { rawValue }
    var name: String {
        switch self { case .serif: return "New York"; case .sans: return "San Francisco"; case .rounded: return "Rounded" }
    }
    var design: Font.Design {
        switch self { case .serif: return .serif; case .sans: return .default; case .rounded: return .rounded }
    }
}

/// Simple generated cover used when the EPUB has none.
struct GeneratedCover: View {
    let title: String
    let author: String
    var body: some View {
        let hue = Double(title.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) % 360 }) / 360
        ZStack {
            LinearGradient(colors: [Color(hue: hue, saturation: 0.55, brightness: 0.45),
                                    Color(hue: hue, saturation: 0.7, brightness: 0.22)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            GeometryReader { g in
                if g.size.width < 80 {
                    Text(String(title.prefix(1)))
                        .font(.system(size: g.size.width * 0.5, weight: .bold, design: .serif))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 8) {
                        Text(title).font(.system(.headline, design: .serif)).multilineTextAlignment(.center)
                        Text(author).font(.caption).opacity(0.8)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .foregroundStyle(.white)
        }
    }
}

struct CoverImage: View {
    let book: Book
    @EnvironmentObject var app: AppModel
    var body: some View {
        Group {
            if let url = app.library.coverURL(book), let img = PlatformImage.load(url) {
                img.resizable().aspectRatio(contentMode: .fill)
            } else {
                GeneratedCover(title: book.title, author: book.author)
            }
        }
    }
}

enum PlatformImage {
    static func load(_ url: URL) -> Image? {
        #if os(iOS)
        guard let ui = UIImage(contentsOfFile: url.path) else { return nil }
        return Image(uiImage: ui)
        #else
        guard let ns = NSImage(contentsOf: url) else { return nil }
        return Image(nsImage: ns)
        #endif
    }
}

func formatDuration(_ t: TimeInterval) -> String {
    let m = Int(t / 60)
    if m >= 60 { return "\(m / 60)h \(m % 60)m" }
    if m >= 1 { return "\(m) min" }
    return "<1 min"
}
