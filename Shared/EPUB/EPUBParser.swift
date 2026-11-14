import Foundation
import CryptoKit

enum EPUBError: LocalizedError {
    case missingContainer, missingOPF, emptySpine
    var errorDescription: String? {
        switch self {
        case .missingContainer: return "This doesn't look like an EPUB (META-INF/container.xml is missing)."
        case .missingOPF: return "The EPUB's package file couldn't be found."
        case .emptySpine: return "The EPUB has no readable chapters."
        }
    }
}

/// Reads the package metadata of an extracted EPUB folder.
enum EPUBParser {
    struct Parsed {
        var identifier: String
        var title: String
        var author: String
        var chapters: [ChapterRef]
        var coverPath: String?
    }

    static func parse(root: URL) throws -> Parsed {
        let containerURL = root.appendingPathComponent("META-INF/container.xml")
        guard let containerData = try? Data(contentsOf: containerURL) else { throw EPUBError.missingContainer }
        var opfPath: String?
        HTMLTokenizer.tokenize(containerData) { t in
            if case let .open(name, attrs, _) = t, name == "rootfile", opfPath == nil {
                opfPath = attrs["full-path"]
            }
        }
        guard let opfPath, let opfData = try? Data(contentsOf: root.appendingPathComponent(opfPath)) else { throw EPUBError.missingOPF }
        let opfDir = (opfPath as NSString).deletingLastPathComponent

        struct Item { var href: String; var type: String; var props: String }
        var items: [String: Item] = [:]
        var spine: [String] = []
        var tocID: String?
        var title = "", author = "", identifiers: [String: String] = [:], firstIdentifier = ""
        var uniqueIDRef: String?
        var coverID: String?
        var current: String?
        var currentAttrs: [String: String] = [:]
        var buffer = ""

        HTMLTokenizer.tokenize(opfData) { t in
            switch t {
            case let .open(name, attrs, selfClosing):
                switch name {
                case "package": uniqueIDRef = attrs["unique-identifier"]
                case "item":
                    if let id = attrs["id"], let href = attrs["href"] {
                        items[id] = Item(href: href, type: attrs["media-type"] ?? "", props: attrs["properties"] ?? "")
                    }
                case "itemref":
                    if let id = attrs["idref"], attrs["linear"] != "no" { spine.append(id) }
                case "spine": tocID = attrs["toc"]
                case "meta":
                    if attrs["name"] == "cover" { coverID = attrs["content"] }
                case "title", "creator", "identifier":
                    if !selfClosing { current = name; currentAttrs = attrs; buffer = "" }
                default: break
                }
            case let .text(s):
                if current != nil { buffer += s }
            case let .close(name):
                guard name == current else { return }
                let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
                switch name {
                case "title": if title.isEmpty { title = value }
                case "creator": if author.isEmpty { author = value }
                case "identifier":
                    if firstIdentifier.isEmpty { firstIdentifier = value }
                    if let id = currentAttrs["id"] { identifiers[id] = value }
                default: break
                }
                current = nil
            }
        }

        func full(_ href: String) -> String { ChapterParser.resolve(href, relativeTo: opfDir) }

        // Table of contents: href -> title
        var tocTitles: [String: String] = [:]
        if let navItem = items.values.first(where: { $0.props.contains("nav") }),
           let navData = try? Data(contentsOf: root.appendingPathComponent(full(navItem.href))) {
            let navDir = (full(navItem.href) as NSString).deletingLastPathComponent
            parseNav(navData) { href, label in
                let path = ChapterParser.resolve(href, relativeTo: navDir)
                if tocTitles[path] == nil { tocTitles[path] = label }
            }
        }
        if tocTitles.isEmpty {
            let ncx = tocID.flatMap { items[$0] } ?? items.values.first(where: { $0.type.contains("ncx") })
            if let ncx, let ncxData = try? Data(contentsOf: root.appendingPathComponent(full(ncx.href))) {
                let ncxDir = (full(ncx.href) as NSString).deletingLastPathComponent
                parseNCX(ncxData) { href, label in
                    let path = ChapterParser.resolve(href, relativeTo: ncxDir)
                    if tocTitles[path] == nil { tocTitles[path] = label }
                }
            }
        }

        var chapters: [ChapterRef] = []
        var untitled = 0
        for id in spine {
            guard let item = items[id], item.type.contains("html") || item.href.hasSuffix("html") || item.href.hasSuffix("htm") else { continue }
            let path = full(item.href)
            let label: String
            if let t = tocTitles[path], !t.isEmpty { label = t } else { untitled += 1; label = "" }
            chapters.append(ChapterRef(title: label, path: path))
        }
        guard !chapters.isEmpty else { throw EPUBError.emptySpine }
        // Fill gaps with neighbor-aware names.
        var lastTitle = title
        var partCount = 0
        for i in chapters.indices {
            if chapters[i].title.isEmpty {
                partCount += 1
                chapters[i].title = i == 0 ? "Beginning" : "\(lastTitle) (cont.)"
            } else {
                lastTitle = chapters[i].title; partCount = 0
            }
        }

        var cover: String?
        if let item = items.values.first(where: { $0.props.contains("cover-image") }) { cover = full(item.href) }
        else if let cid = coverID, let item = items[cid] { cover = full(item.href) }
        else if let item = items.first(where: { $0.key.lowercased().contains("cover") && $0.value.type.hasPrefix("image") })?.value { cover = full(item.href) }

        let identifier = uniqueIDRef.flatMap { identifiers[$0] } ?? firstIdentifier
        return Parsed(identifier: identifier,
                      title: title.isEmpty ? root.deletingPathExtension().lastPathComponent : title,
                      author: author.isEmpty ? "Unknown author" : author,
                      chapters: chapters, coverPath: cover)
    }

    /// Stable across devices so progress for the same book syncs.
    static func bookID(identifier: String, title: String, author: String) -> String {
        let key = "\(identifier)|\(title.lowercased())|\(author.lowercased())"
        let digest = SHA256.hash(data: Data(key.utf8))
        return digest.prefix(10).map { String(format: "%02x", $0) }.joined()
    }

    private static func parseNav(_ data: Data, _ found: (String, String) -> Void) {
        var inTOC = false, navDepth = 0
        var href: String?
        var label = ""
        HTMLTokenizer.tokenize(data) { t in
            switch t {
            case let .open(name, attrs, _):
                if name == "nav" {
                    navDepth += 1
                    let type = attrs["epub:type"] ?? attrs["type"] ?? attrs["role"] ?? ""
                    if type.contains("toc") || (!inTOC && type.isEmpty) { inTOC = true; navDepth = 1 }
                } else if inTOC && name == "a" {
                    href = attrs["href"]; label = ""
                }
            case let .text(s):
                if href != nil { label += s }
            case let .close(name):
                if name == "a", let h = href {
                    found(h, label.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " "))
                    href = nil
                } else if name == "nav", inTOC {
                    navDepth -= 1
                    if navDepth <= 0 { inTOC = false }
                }
            }
        }
    }

    private static func parseNCX(_ data: Data, _ found: (String, String) -> Void) {
        var labels: [String] = []
        var inText = false
        var buffer = ""
        HTMLTokenizer.tokenize(data) { t in
            switch t {
            case let .open(name, attrs, _):
                if name == "text" { inText = true; buffer = "" }
                if name == "content", let src = attrs["src"] {
                    found(src, labels.last ?? "")
                }
            case let .text(s): if inText { buffer += s }
            case let .close(name):
                if name == "text" { inText = false; labels.append(buffer.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }
        }
    }
}
