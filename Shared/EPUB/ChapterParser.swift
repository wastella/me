import Foundation

/// Converts a chapter's XHTML into a flat list of blocks (paragraphs, headings, images).
enum ChapterParser {
    private static let blockTags: Set<String> = [
        "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "section",
        "article", "tr", "td", "th", "dt", "dd", "pre", "figure", "figcaption", "table",
        "ul", "ol", "header", "footer", "aside", "nav", "body", "main", "center", "caption",
    ]
    private static let skipTags: Set<String> = ["head", "script", "style", "title", "svg:title", "noscript"]
    private static let headingTags: Set<String> = ["h1", "h2", "h3", "h4", "h5", "h6"]

    /// - Parameters:
    ///   - data: raw XHTML bytes
    ///   - chapterPath: path of the chapter relative to the book content root (used to resolve image paths)
    static func parse(_ data: Data, chapterPath: String) -> [Block] {
        var blocks: [Block] = []
        var text = ""
        var utf16Count = 0
        var runs: [StyleRun] = []
        var lastWasSpace = true
        var boldDepth = 0, italicDepth = 0, skipDepth = 0, headingDepth = 0
        let chapterDir = (chapterPath as NSString).deletingLastPathComponent

        func flush() {
            // Trim trailing whitespace.
            while let last = text.last, last.isWhitespace {
                text.removeLast()
            }
            utf16Count = text.utf16.count
            if !text.isEmpty {
                let clamped = runs.compactMap { r -> StyleRun? in
                    let end = min(r.start + r.length, utf16Count)
                    guard end > r.start else { return nil }
                    var c = r; c.length = end - r.start; return c
                }
                let isSeparator = text.allSatisfy { "*~-=_•·#◇◆ ".contains($0) }
                let kind: Block.Kind = isSeparator ? .separator : (headingDepth > 0 ? .heading : .paragraph)
                blocks.append(Block(kind: kind, text: text, runs: clamped))
            }
            text = ""; utf16Count = 0; runs = []; lastWasSpace = true
        }

        func append(_ raw: String) {
            var piece = ""
            for ch in raw {
                if ch == "\u{FEFF}" || ch == "\u{200B}" || ch == "\u{00AD}" { continue }
                if ch.isWhitespace || ch == "\u{00A0}" {
                    if !lastWasSpace { piece.append(" "); lastWasSpace = true }
                } else {
                    piece.append(ch); lastWasSpace = false
                }
            }
            guard !piece.isEmpty else { return }
            let start = utf16Count
            let len = piece.utf16.count
            text += piece
            utf16Count += len
            if boldDepth > 0 || italicDepth > 0 {
                let b = boldDepth > 0, it = italicDepth > 0
                if var last = runs.last, last.start + last.length == start, last.bold == b, last.italic == it {
                    last.length += len; runs[runs.count - 1] = last
                } else {
                    runs.append(StyleRun(start: start, length: len, bold: b, italic: it))
                }
            }
        }

        HTMLTokenizer.tokenize(data) { token in
            switch token {
            case let .open(name, attrs, selfClosing):
                if skipTags.contains(name) { if !selfClosing { skipDepth += 1 }; return }
                guard skipDepth == 0 else { return }
                if blockTags.contains(name) { flush() }
                switch name {
                case "br":
                    if !text.isEmpty { flush() }
                case "hr":
                    flush(); blocks.append(Block(kind: .separator, text: ""))
                case "b", "strong": if !selfClosing { boldDepth += 1 }
                case "i", "em", "cite", "var", "dfn": if !selfClosing { italicDepth += 1 }
                case "img", "image":
                    let src = attrs["src"] ?? attrs["xlink:href"] ?? attrs["href"]
                    if let src, !src.isEmpty {
                        flush()
                        let resolved = resolve(src, relativeTo: chapterDir)
                        blocks.append(Block(kind: .image, text: attrs["alt"] ?? "", src: resolved))
                    }
                default:
                    if headingTags.contains(name) && !selfClosing { headingDepth += 1 }
                }
            case let .close(name):
                if skipTags.contains(name) { skipDepth = max(0, skipDepth - 1); return }
                guard skipDepth == 0 else { return }
                switch name {
                case "b", "strong": boldDepth = max(0, boldDepth - 1)
                case "i", "em", "cite", "var", "dfn": italicDepth = max(0, italicDepth - 1)
                default: break
                }
                if blockTags.contains(name) { flush() }
                if headingTags.contains(name) { headingDepth = max(0, headingDepth - 1) }
            case let .text(s):
                guard skipDepth == 0 else { return }
                append(s)
            }
        }
        flush()
        // Collapse runs of separators.
        var result: [Block] = []
        for b in blocks {
            if b.kind == .separator, result.last?.kind == .separator { continue }
            result.append(b)
        }
        while result.first?.kind == .separator { result.removeFirst() }
        return result
    }

    static func resolve(_ href: String, relativeTo dir: String) -> String {
        let clean = (href.components(separatedBy: "#").first ?? href).removingPercentEncoding ?? href
        if clean.hasPrefix("/") { return String(clean.dropFirst()) }
        var parts = dir.isEmpty ? [] : dir.components(separatedBy: "/")
        for comp in clean.components(separatedBy: "/") {
            switch comp {
            case "", ".": continue
            case "..": if !parts.isEmpty { parts.removeLast() }
            default: parts.append(comp)
            }
        }
        return parts.joined(separator: "/")
    }
}
