import SwiftUI

struct ReaderView: View {
    let book: Book
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var library: Library
    @EnvironmentObject var progress: ProgressStore
    @EnvironmentObject var narrator: Narrator

    @AppStorage("theme") private var theme: ReaderTheme = .dark
    @AppStorage("fontSize") private var fontSize: Double = 20
    @AppStorage("font") private var font: ReaderFont = .serif
    @AppStorage("lineSpacing") private var lineSpacing: Double = 1.5

    @State private var chapter = 0
    @State private var blocks: [Block] = []
    @State private var visible: [Int] = []
    @State private var userScrolling = false
    @State private var following = true
    @State private var restored = false
    @State private var showTOC = false
    @State private var showAppearance = false
    @State private var pendingScroll: ScrollRequest?
    @State private var chromeHidden = false
    @State private var showPlayer = false

    private var isNarratingThis: Bool { narrator.book?.id == book.id }
    private var isPlayingThis: Bool { isNarratingThis && narrator.isPlaying }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: fontSize * 0.9) {
                    chapterHeader.id(-1)
                    ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                        BlockView(block: block, book: book,
                                  highlight: highlight(for: index),
                                  isCurrent: isNarratingThis && narrator.position.chapter == chapter && narrator.position.block == index,
                                  theme: theme, fontSize: fontSize, font: font, lineSpacing: lineSpacing)
                            .id(index)
                            .contentShape(Rectangle())
                            .onTapGesture(count: 2) { listen(from: index) }
                            .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { chromeHidden.toggle() } }
                            .contextMenu {
                                Button { listen(from: index) } label: { Label("Listen from Here", systemImage: "headphones") }
                            }
                    }
                    chapterFooter.id(blocks.count)
                }
                .scrollTargetLayout()
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .onScrollTargetVisibilityChange(idType: Int.self, threshold: 0.2) { ids in
                visible = ids.filter { $0 >= 0 }.sorted()
            }
            .onScrollPhaseChange { old, new in
                if new == .interacting {
                    userScrolling = true
                    if !chromeHidden { withAnimation(.easeInOut(duration: 0.25)) { chromeHidden = true } }
                    if isPlayingThis { following = false }
                }
                if new == .idle && (old == .interacting || old == .decelerating) {
                    userScrolling = false
                    saveReadingPosition()
                }
            }
            .onChange(of: pendingScroll?.id) { _, _ in
                guard let s = pendingScroll else { return }
                pendingScroll = nil
                DispatchQueue.main.async {
                    if s.animated { withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(s.block, anchor: s.anchor) } }
                    else { proxy.scrollTo(s.block, anchor: s.anchor) }
                }
            }
        }
        .background(theme.background.ignoresSafeArea())
        .foregroundStyle(theme.text)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(theme.background, for: .navigationBar)
        .toolbarColorScheme(theme.colorScheme, for: .navigationBar)
        .toolbar(chromeHidden ? .hidden : .visible, for: .navigationBar)
        .statusBarHidden(chromeHidden)
        #endif
        .navigationTitle(book.chapters[safe: chapter]?.title ?? book.title)
        .toolbar { toolbarContent }
        .safeAreaInset(edge: .bottom) {
            ZStack {
                if !chromeHidden || isPlayingThis {
                    MiniPlayer(book: book, onOpen: { showPlayer = true })
                        .environment(\.colorScheme, .dark)
                } else {
                    chapterStatus
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: chromeHidden)
                .overlay(alignment: .top) {
                    if isPlayingThis && !following {
                        Button { following = true; followNarrator(animated: true) } label: {
                            Label("Back to narration", systemImage: "waveform")
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 16).padding(.vertical, 9)
                                .background(Palette.accent, in: Capsule())
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
                        }
                        .buttonStyle(PressableStyle())
                        .offset(y: -52)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isPlayingThis && !following)
        .sheet(isPresented: $showPlayer) {
            NowPlayingView(book: book, onRead: { showPlayer = false })
                .presentationDragIndicator(.visible)
                #if os(macOS)
                .frame(minWidth: 460, minHeight: 720)
                #endif
        }
        .sheet(isPresented: $showTOC) {
            TOCView(book: book, current: chapter) { idx in
                showTOC = false
                go(toChapter: idx, block: 0)
            }
        }
        .onAppear(perform: initialLoad)
        .onDisappear { saveReadingPosition() }
        .onChange(of: narrator.position) { _, pos in narratorMoved(pos) }
        .onChange(of: narrator.isPlaying) { _, playing in
            if playing { following = true; followNarrator(animated: true) }
        }
        .onChange(of: progress.lastRemoteJump?.id) { _, _ in
            // Another device moved ahead while this screen was open.
            guard progress.lastRemoteJump?.bookID == book.id, !isPlayingThis else { return }
            let p = progress.position(for: book.id)
            go(toChapter: p.chapter, block: p.block)
        }
    }

    // MARK: Pieces

    /// Minimal footer while reading full-screen.
    private var chapterStatus: some View {
        let pct = blocks.isEmpty ? 0 : Int(Double(visible.first ?? 0) / Double(blocks.count) * 100)
        return Text("\(book.chapters[safe: chapter]?.title ?? "") · \(pct)%")
            .font(.caption2.monospacedDigit()).foregroundStyle(theme.secondary)
            .lineLimit(1).padding(.horizontal, 40).padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { chromeHidden = false } }
            .transition(.opacity)
    }

    private var chapterHeader: some View {
        Text("Chapter \(chapter + 1) of \(book.chapters.count)")
            .font(.caption).textCase(.uppercase).tracking(1)
            .foregroundStyle(theme.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
    }

    private var chapterFooter: some View {
        VStack(spacing: 16) {
            Divider().padding(.vertical, 20)
            if chapter + 1 < book.chapters.count {
                Button { go(toChapter: chapter + 1, block: 0) } label: {
                    VStack(spacing: 4) {
                        Text("Next chapter").font(.caption).textCase(.uppercase).foregroundStyle(theme.secondary)
                        Text(book.chapters[chapter + 1].title).font(.system(.title3, design: font.design).weight(.semibold))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
                    .background(theme.text.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(PressableStyle())
            } else {
                Text("The End").font(.system(.title2, design: .serif)).foregroundStyle(theme.secondary)
            }
            if chapter > 0 {
                Button("Previous chapter") { go(toChapter: chapter - 1, block: 0) }
                    .font(.footnote).foregroundStyle(theme.secondary).buttonStyle(.plain)
            }
        }
        .padding(.bottom, 40)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button { showTOC = true } label: { Label("Chapters", systemImage: "list.bullet") }
            Button { showAppearance.toggle() } label: { Label("Appearance", systemImage: "textformat.size") }
                .popover(isPresented: $showAppearance) {
                    AppearanceView().padding().frame(minWidth: 300)
                        .presentationCompactAdaptation(.popover)
                }
        }
    }

    private func highlight(for index: Int) -> NSRange? {
        guard isNarratingThis, narrator.position.chapter == chapter, narrator.position.block == index else { return nil }
        return narrator.wordRange
    }

    // MARK: Behavior

    private func initialLoad() {
        guard !restored else { return }
        let pos = isPlayingThis ? narrator.position : progress.position(for: book.id)
        chapter = min(pos.chapter, book.chapters.count - 1)
        blocks = library.blocks(book, chapter: chapter)
        pendingScroll = ScrollRequest(pos.block, isPlayingThis ? UnitPoint(x: 0.5, y: 0.25) : .top, false)
        // Only start recording scroll positions once we've restored.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { restored = true }
    }

    private func go(toChapter idx: Int, block: Int) {
        guard book.chapters.indices.contains(idx) else { return }
        if idx != chapter {
            chapter = idx
            blocks = library.blocks(book, chapter: idx)
        }
        pendingScroll = ScrollRequest(block == 0 ? -1 : block, .top, false)
        let pos = Position(chapter: idx, block: block)
        if isPlayingThis { narrator.seek(to: pos); following = true }
        else {
            progress.update(book.id, pos)
            narrator.readerMoved(to: pos, in: book)
        }
    }

    private func listen(from index: Int) {
        let pos = Position(chapter: chapter, block: index)
        progress.update(book.id, pos, pushNow: true)
        narrator.play(book, from: pos)
        following = true
    }

    /// Records where you are when reading (not listening), so the narrator starts here.
    private func saveReadingPosition() {
        guard restored, !isPlayingThis, let top = visible.first, top < blocks.count else { return }
        let current = progress.position(for: book.id)
        // Same paragraph as the stored position (e.g. paused mid-paragraph): keep the precise word.
        if current.chapter == chapter && current.block == top { return }
        let pos = Position(chapter: chapter, block: top)
        progress.update(book.id, pos)
        narrator.readerMoved(to: pos, in: book)
    }

    private func narratorMoved(_ pos: Position) {
        guard isPlayingThis else { return }
        if pos.chapter != chapter {
            guard following else { return }
            chapter = pos.chapter
            blocks = library.blocks(book, chapter: pos.chapter)
            pendingScroll = ScrollRequest(pos.block, UnitPoint(x: 0.5, y: 0.25), false)
            return
        }
        if following && !userScrolling { followNarrator(animated: true) }
    }

    private func followNarrator(animated: Bool) {
        guard isNarratingThis else { return }
        let pos = narrator.position
        if pos.chapter != chapter {
            chapter = pos.chapter
            blocks = library.blocks(book, chapter: pos.chapter)
        }
        // Only scroll when the spoken paragraph is drifting out of the comfortable reading zone.
        let comfortable = visible.count > 2 ? Array(visible.dropLast().dropFirst()) : visible
        if comfortable.contains(pos.block) && !(visible.first == pos.block) { return }
        pendingScroll = ScrollRequest(pos.block, UnitPoint(x: 0.5, y: 0.2), animated)
    }
}

struct BlockView: View {
    let block: Block
    let book: Book
    let highlight: NSRange?
    let isCurrent: Bool
    let theme: ReaderTheme
    let fontSize: Double
    let font: ReaderFont
    let lineSpacing: Double
    @EnvironmentObject var library: Library

    var body: some View {
        switch block.kind {
        case .paragraph, .heading:
            Text(attributed)
                .font(.system(size: block.kind == .heading ? fontSize * 1.35 : fontSize,
                              weight: block.kind == .heading ? .semibold : .regular, design: font.design))
                .lineSpacing(fontSize * (lineSpacing - 1))
                .frame(maxWidth: .infinity, alignment: block.kind == .heading ? .center : .leading)
                .multilineTextAlignment(block.kind == .heading ? .center : .leading)
                .padding(.vertical, block.kind == .heading ? fontSize * 0.6 : 0)
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    if isCurrent {
                        RoundedRectangle(cornerRadius: 2).fill(theme.highlight.opacity(1)).frame(width: 3)
                    }
                }
                .textSelection(.enabled)
                .opacity(block.muted ? 0.35 : 1)   // site watermarks / repeated titles / notes: shown, not read
        case .separator:
            Text("⁂").font(.title3).foregroundStyle(theme.secondary).frame(maxWidth: .infinity)
        case .image:
            if let src = block.src, let img = PlatformImage.load(library.fileURL(book, path: src)) {
                img.resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: 520)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private var attributed: AttributedString {
        var s = AttributedString(block.text)
        for run in block.runs {
            if let r = Range(NSRange(location: run.start, length: run.length), in: s) {
                var intent: InlinePresentationIntent = []
                if run.bold { intent.insert(.stronglyEmphasized) }
                if run.italic { intent.insert(.emphasized) }
                s[r].inlinePresentationIntent = intent
            }
        }
        if let h = highlight, let r = Range(h, in: s) {
            s[r].backgroundColor = theme.highlight
        }
        return s
    }
}

struct AppearanceView: View {
    @AppStorage("theme") private var theme: ReaderTheme = .dark
    @AppStorage("fontSize") private var fontSize: Double = 20
    @AppStorage("font") private var font: ReaderFont = .serif
    @AppStorage("lineSpacing") private var lineSpacing: Double = 1.5

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Button { fontSize = max(12, fontSize - 1) } label: { Image(systemName: "textformat.size.smaller").frame(maxWidth: .infinity) }
                Text("\(Int(fontSize))").monospacedDigit().frame(width: 36)
                Button { fontSize = min(40, fontSize + 1) } label: { Image(systemName: "textformat.size.larger").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.bordered)
            HStack(spacing: 10) {
                ForEach(ReaderTheme.allCases) { t in
                    Button { theme = t } label: {
                        Circle().fill(t.background)
                            .overlay(Text("Aa").font(.caption.bold()).foregroundStyle(t.text))
                            .overlay(Circle().stroke(theme == t ? Color.accentColor : .gray.opacity(0.4), lineWidth: theme == t ? 3 : 1))
                            .frame(width: 44, height: 44)
                    }.buttonStyle(.plain)
                }
            }
            Picker("Font", selection: $font) {
                ForEach(ReaderFont.allCases) { Text($0.name).tag($0) }
            }.pickerStyle(.segmented)
            HStack {
                Image(systemName: "line.3.horizontal").foregroundStyle(.secondary)
                Slider(value: $lineSpacing, in: 1.1...2.0)
            }
        }
    }
}

struct TOCView: View {
    let book: Book
    let current: Int
    let onSelect: (Int) -> Void
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    ForEach(filtered, id: \.self) { idx in
                        Button { onSelect(idx) } label: {
                            HStack {
                                Text(book.chapters[idx].title).foregroundStyle(idx == current ? Color.accentColor : .primary)
                                    .fontWeight(idx == current ? .semibold : .regular)
                                Spacer()
                                Text("\(idx + 1)").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(idx)
                    }
                }
                .onAppear { proxy.scrollTo(current, anchor: .center) }
            }
            .searchable(text: $query, prompt: "Chapter name or number")
            .navigationTitle("Chapters")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 560)
        #endif
    }

    static func chapterNumber(_ title: String) -> Int? {
        guard let r = title.range(of: #"(?i)\bchapter\s*(\d+)"#, options: .regularExpression) else { return nil }
        return Int(title[r].filter(\.isNumber))
    }

    private var filtered: [Int] {
        let all = Array(book.chapters.indices)
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return all }
        if let n = Int(q) {
            // Match the chapter number in the title ("Chapter 2031 …"), not the file position:
            // web-novel EPUBs have intro / volume pages that shift the spine.
            let numbered = all.filter { Self.chapterNumber(book.chapters[$0].title) == n }
            let rest = all.filter { !numbered.contains($0) && book.chapters[$0].title.localizedCaseInsensitiveContains(q) }
            if numbered.isEmpty, book.chapters.indices.contains(n - 1) { return [n - 1] + rest.filter { $0 != n - 1 } }
            return numbered + rest
        }
        return all.filter { book.chapters[$0].title.localizedCaseInsensitiveContains(q) }
    }
}

struct ScrollRequest {
    let id = UUID()
    var block: Int
    var anchor: UnitPoint
    var animated: Bool
    init(_ block: Int, _ anchor: UnitPoint, _ animated: Bool) { self.block = block; self.anchor = anchor; self.animated = animated }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
