import CarPlay
import UIKit

/// The MeReader app on the CarPlay dashboard.
///
/// Tap "Continue" and it pulls your latest place from your other devices, then plays it and
/// shows Now Playing. The library below lets you switch books.
///
/// Showing up on a real car's dashboard requires Apple's CarPlay audio entitlement (paid developer
/// account + approval). Until then this runs in the simulator's CarPlay screen only; on the phone,
/// CarPlay's built-in Now Playing + steering wheel controls still drive MeReader.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var root: CPListTemplate?

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
        MainActor.assumeIsolated {
            let nowPlaying = CPNowPlayingTemplate.shared
            nowPlaying.isUpNextButtonEnabled = false
            nowPlaying.isAlbumArtistButtonEnabled = false
            nowPlaying.updateNowPlayingButtons([
                CPNowPlayingPlaybackRateButton { _ in
                    let n = AppModel.shared.narrator
                    let speeds = [1.0, 1.25, 1.5, 1.75, 2.0]
                    let i = speeds.firstIndex(of: n.rate) ?? 0
                    n.rate = speeds[(i + 1) % speeds.count]
                },
            ])
            let template = CPListTemplate(title: "MeReader", sections: sections(syncing: true))
            template.emptyViewTitleVariants = ["No books yet"]
            template.emptyViewSubtitleVariants = ["Add an EPUB on your iPhone or Mac."]
            root = template
            interfaceController.setRootTemplate(template, animated: false, completion: nil)

            // Refresh positions as soon as the car connects, then redraw with the latest chapter.
            Task { @MainActor in
                await AppModel.shared.progress.syncPositions()
                self.root?.updateSections(self.sections(syncing: false))
            }
        }
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        self.interfaceController = nil
        root = nil
    }

    @MainActor
    private func sections(syncing: Bool) -> [CPListSection] {
        let app = AppModel.shared
        var out: [CPListSection] = []
        if let book = app.mostRecentBook {
            let pos = app.progress.position(for: book.id)
            let chapter = book.chapters[safe: pos.chapter]?.title ?? ""
            let item = CPListItem(text: "Continue \(book.title)",
                                  detailText: syncing ? "Syncing your place…" : chapter,
                                  image: cover(book) ?? UIImage(systemName: "play.circle.fill"))
            item.isPlaying = app.narrator.isPlaying && app.narrator.book?.id == book.id
            item.handler = { [weak self] _, done in
                MainActor.assumeIsolated {
                    self?.interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
                    Task { @MainActor in await app.continueListening() }
                }
                done()
            }
            out.append(CPListSection(items: [item]))
        }
        let others = app.library.books
            .filter { $0.id != app.mostRecentBook?.id }
            .sorted { (app.progress.records[$0.id]?.updatedAt ?? $0.addedAt) > (app.progress.records[$1.id]?.updatedAt ?? $1.addedAt) }
        if !others.isEmpty {
            let items: [CPListItem] = others.map { book in
                let pos = app.progress.position(for: book.id)
                let item = CPListItem(text: book.title, detailText: book.chapters[safe: pos.chapter]?.title, image: cover(book))
                item.handler = { [weak self] _, done in
                    MainActor.assumeIsolated {
                        app.narrator.play(book)
                        self?.interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
                    }
                    done()
                }
                return item
            }
            out.append(CPListSection(items: items, header: "Library", sectionIndexTitle: nil))
        }
        return out
    }

    @MainActor
    private func cover(_ book: Book) -> UIImage? {
        AppModel.shared.library.coverURL(book).flatMap { UIImage(contentsOfFile: $0.path) }
    }
}
