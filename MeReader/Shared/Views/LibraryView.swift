import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var library: Library
    @EnvironmentObject var progress: ProgressStore
    @EnvironmentObject var narrator: Narrator
    @State private var showImporter = false
    @State private var showSettings = false
    @State private var showSync = false
    @State private var showPlayer = false
    @State private var path: [Book] = []
    @State private var bookToDelete: Book?
    @State private var dropTargeted = false

    private var importTypes: [UTType] {
        #if os(macOS)
        return [.epub, .folder]
        #else
        return [.epub]
        #endif
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                Palette.bg.ignoresSafeArea()
                if library.books.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 28) {
                            #if os(iOS)
                            if AppExpiry.isSoon { expiryCard }
                            #endif
                            if !progress.sync.isConfigured { connectCard }
                            if let current = narrator.book ?? recentBook {
                                HeroCard(book: current,
                                         onRead: { path = [current] },
                                         onListen: { narrator.book?.id == current.id ? narrator.toggle() : narrator.play(current) },
                                         onOpenPlayer: { showPlayer = true })
                                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                            }
                            shelf
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                        .frame(maxWidth: 1100)
                        .frame(maxWidth: .infinity)
                        .animation(.smooth, value: narrator.book?.id)
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .navigationTitle("Library")
            .navigationDestination(for: Book.self) { book in ReaderView(book: book) }
            .toolbar {
                ToolbarItem(placement: syncPlacement) { SyncPill { showSync = true } }
                ToolbarItem(placement: .primaryAction) {
                    Button { showImporter = true } label: { Label("Add Book", systemImage: "plus") }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
                }
            }
            .overlay(alignment: .bottom) {
                if let status = library.importStatus {
                    HStack(spacing: 10) { ProgressView().controlSize(.small); Text(status).font(.subheadline).lineLimit(1) }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, narrator.book == nil ? 16 : 90)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .overlay {
                if dropTargeted {
                    RoundedRectangle(cornerRadius: 24).stroke(Palette.accent, style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
                        .background(Palette.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 24))
                        .overlay(Label("Drop to add", systemImage: "plus.circle.fill").font(.title2.bold()).foregroundStyle(Palette.accent))
                        .padding(12).allowsHitTesting(false)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if narrator.book != nil && path.isEmpty {
                    MiniPlayer(onOpen: { showPlayer = true })
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: narrator.book != nil)
            .animation(.smooth, value: library.importStatus)
            #if os(iOS)
            .toolbarBackground(Palette.bg, for: .navigationBar)
            #endif
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: importTypes, allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { Task { await app.importFiles(urls) } }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showSync) {
            SyncDetailView().padding(20)
                .presentationDetents([.medium])
                .presentationBackground(Palette.surface)
                #if os(macOS)
                .frame(width: 440)
                #endif
        }
        .sheet(isPresented: $showPlayer) {
            if let b = narrator.book ?? recentBook {
                NowPlayingView(book: b, onRead: { showPlayer = false; path = [b] })
                    .presentationDragIndicator(.visible)
                    #if os(macOS)
                    .frame(minWidth: 460, minHeight: 720)
                    #endif
            }
        }
        .confirmationDialog("Remove “\(bookToDelete?.title ?? "")”?", isPresented: Binding(get: { bookToDelete != nil }, set: { if !$0 { bookToDelete = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) { if let b = bookToDelete { app.delete(b) }; bookToDelete = nil }
        } message: {
            Text("Your reading position is kept and will come back if you add the book again.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { app.errorMessage != nil }, set: { if !$0 { app.errorMessage = nil } })) {
            Button("OK") { app.errorMessage = nil }
        } message: { Text(app.errorMessage ?? "") }
        #if DEBUG
        .task {
            let env = ProcessInfo.processInfo.environment
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if env["NARRATE_OPEN"] != nil, let b = library.books.first { path = [b] }
            if env["NARRATE_PLAY"] != nil, let b = library.books.first { narrator.play(b) }
            if env["NARRATE_PLAYER"] != nil { showPlayer = true }
            if env["NARRATE_CONTINUE"] != nil { await app.continueListening() }
            if let t = env["NARRATE_SKIP"], let secs = Double(t) { try? await Task.sleep(nanoseconds: 4_000_000_000); narrator.skip(seconds: secs) }
        }
        #endif
        .dropDestination(for: URL.self) { urls, _ in
            let epubs = urls.filter { $0.pathExtension.lowercased() == "epub" }
            guard !epubs.isEmpty else { return false }
            Task { await app.importFiles(epubs) }
            return true
        } isTargeted: { t in withAnimation(.snappy) { dropTargeted = t } }
    }

    private var syncPlacement: ToolbarItemPlacement {
        #if os(iOS)
        return .topBarLeading
        #else
        return .navigation
        #endif
    }

    private var recentBook: Book? {
        library.books.max { (progress.records[$0.id]?.updatedAt ?? .distantPast) < (progress.records[$1.id]?.updatedAt ?? .distantPast) }
            .flatMap { progress.records[$0.id] != nil ? $0 : nil } ?? library.books.first
    }

    private var shelf: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Shelf").font(.title3.weight(.bold))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130, maximum: 190), spacing: 18)], spacing: 26) {
                ForEach(library.books) { book in
                    NavigationLink(value: book) { BookCard(book: book) }
                        .buttonStyle(PressableStyle())
                        .contextMenu {
                            Button { path = [book] } label: { Label("Read", systemImage: "book") }
                            Button { narrator.play(book) } label: { Label("Listen", systemImage: "headphones") }
                            Divider()
                            Button(role: .destructive) { bookToDelete = book } label: { Label("Remove from Library", systemImage: "trash") }
                        }
                }
            }
        }
    }

    #if os(iOS)
    private var expiryCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "clock.badge.exclamationmark").font(.title2).foregroundStyle(Palette.warn)
            VStack(alignment: .leading, spacing: 2) {
                Text(AppExpiry.daysLeft.map { $0 <= 0 ? "MeReader expires today" : "MeReader expires in \($0) day\($0 == 1 ? "" : "s")" } ?? "MeReader expires soon")
                    .font(.subheadline.weight(.semibold))
                Text("Keep your Mac on the same Wi‑Fi and it reinstalls automatically. Your place is safe either way.")
                    .font(.caption).foregroundStyle(Palette.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.warn.opacity(0.35)))
    }
    #endif

    private var connectCard: some View {
        Button { showSync = true } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(Palette.accent.opacity(0.15)).frame(width: 44, height: 44)
                    Image(systemName: "arrow.triangle.2.circlepath.icloud").font(.title3).foregroundStyle(Palette.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Keep your place on every device").font(.subheadline.weight(.semibold))
                    Text("Connect iCloud Drive once. Takes 5 seconds.").font(.caption).foregroundStyle(Palette.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(Palette.tertiary)
            }
            .padding(14)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.accent.opacity(0.25)))
        }
        .buttonStyle(PressableStyle())
        .foregroundStyle(Palette.text)
    }

    private var emptyState: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().fill(Palette.accent.opacity(0.10)).frame(width: 120, height: 120)
                Image(systemName: "books.vertical.fill").font(.system(size: 48)).foregroundStyle(Palette.accent)
            }
            Text("Your library is empty").font(.title2.bold())
            Text("Add any EPUB. Read it, or have it read aloud. MeReader keeps your place between the two, on every device.")
                .multilineTextAlignment(.center).foregroundStyle(Palette.secondary).frame(maxWidth: 360)
            Button { showImporter = true } label: {
                Label("Add an EPUB", systemImage: "plus").font(.headline)
                    .padding(.horizontal, 22).padding(.vertical, 14)
                    .background(Palette.accent, in: Capsule()).foregroundStyle(.white)
            }
            .buttonStyle(PressableStyle())
            if !progress.sync.isConfigured {
                Button("Connect iCloud Drive to bring in books from your other devices") { showSync = true }
                    .font(.footnote).foregroundStyle(Palette.accent).multilineTextAlignment(.center).frame(maxWidth: 320)
            } else {
                Text("Books you add on another device appear here automatically.")
                    .font(.footnote).foregroundStyle(Palette.tertiary)
            }
        }
        .padding()
    }
}

/// The big "pick up where you left off" card.
struct HeroCard: View {
    let book: Book
    var onRead: () -> Void
    var onListen: () -> Void
    var onOpenPlayer: () -> Void
    @EnvironmentObject var narrator: Narrator
    @EnvironmentObject var progress: ProgressStore

    private var isThis: Bool { narrator.book?.id == book.id }
    private var playing: Bool { isThis && narrator.isPlaying }
    private var pos: Position { isThis ? narrator.position : progress.position(for: book.id) }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            CoverImage(book: book)
                .frame(width: 104, height: 156)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
                .onTapGesture(perform: isThis ? onOpenPlayer : onRead)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if playing { LiveBars(active: !narrator.isBuffering) }
                    Text(playing ? "Listening" : "Continue")
                        .font(.caption.weight(.bold)).textCase(.uppercase).tracking(1.2)
                        .foregroundStyle(Palette.accent)
                }
                Text(book.title).font(.title3.weight(.bold)).lineLimit(2)
                Text(book.chapters[safe: pos.chapter]?.title ?? "")
                    .font(.subheadline).foregroundStyle(Palette.secondary).lineLimit(2)
                    .contentTransition(.opacity)
                Spacer(minLength: 8)
                ProgressLine(value: Double(pos.chapter) / Double(max(1, book.chapters.count)))
                Text("Chapter \(pos.chapter + 1) of \(book.chapters.count)")
                    .font(.caption.monospacedDigit()).foregroundStyle(Palette.tertiary)
                HStack(spacing: 10) {
                    Button(action: onRead) {
                        Label("Read", systemImage: "book.fill")
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(Color.white.opacity(0.1), in: Capsule())
                    }
                    Button(action: onListen) {
                        Label(playing ? "Pause" : "Listen", systemImage: playing ? "pause.fill" : "headphones")
                            .contentTransition(.symbolEffect(.replace))
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(Palette.accent, in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .sensoryFeedback(.impact(weight: .light), trigger: playing)
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(PressableStyle())
                .padding(.top, 6)
            }
        }
        .padding(18)
        .foregroundStyle(Palette.text)
        .background(AmbientBackground(book: book, intensity: 1.2))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Palette.stroke))
        .frame(maxWidth: 640, alignment: .leading)
    }
}

struct BookCard: View {
    let book: Book
    @EnvironmentObject var progress: ProgressStore
    @EnvironmentObject var narrator: Narrator

    var body: some View {
        let started = progress.records[book.id] != nil
        let pos = progress.position(for: book.id)
        let fraction = Double(pos.chapter) / Double(max(1, book.chapters.count))
        VStack(alignment: .leading, spacing: 8) {
            CoverImage(book: book)
                .frame(maxWidth: .infinity)
                .aspectRatio(2 / 3, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if narrator.book?.id == book.id && narrator.isPlaying {
                        LiveBars(active: true, color: .white)
                            .padding(7).background(Palette.accent, in: Circle()).padding(8)
                    }
                }
                .shadow(color: .black.opacity(0.45), radius: 10, y: 6)
            if started { ProgressLine(value: fraction, height: 2) }
            Text(book.title).font(.subheadline.weight(.semibold)).lineLimit(2).foregroundStyle(Palette.text)
            Text(started ? "Ch \(pos.chapter + 1) · \(Int((fraction * 100).rounded()))%" : "New")
                .font(.caption.monospacedDigit()).foregroundStyle(Palette.secondary)
        }
        .contentShape(Rectangle())
    }
}
