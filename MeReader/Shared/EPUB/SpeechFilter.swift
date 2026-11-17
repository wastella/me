import Foundation
import NaturalLanguage

/// Cleans up what web-novel EPUBs would otherwise read aloud:
/// - a paragraph repeating the chapter heading right under it (heard twice),
/// - scraper-site watermarks ("Support us at novel bin.com", "ƒгeewebnovёl.com", "<.com>"),
/// - author / translator notes.
///
/// Junk paragraphs are *muted*, not deleted, so block indices (and therefore saved positions)
/// never change. Watermarks inside real paragraphs are cut out of the text. Both devices run the
/// same code on the same file, so offsets stay consistent between them.
enum SpeechFilter {
    static func apply(_ input: [Block], chapterTitle: String) -> [Block] {
        var blocks = input
        stripWatermarks(&blocks)
        muteDuplicateTitle(&blocks, chapterTitle: chapterTitle)
        muteNotes(&blocks)
        return blocks
    }

    // MARK: Duplicate title

    private static func muteDuplicateTitle(_ blocks: inout [Block], chapterTitle: String) {
        var titles = [normalize(chapterTitle)]
        for i in blocks.indices.prefix(6) {
            let b = blocks[i]
            guard b.kind == .paragraph || b.kind == .heading, !b.muted else { continue }
            let n = normalize(b.text)
            if n.isEmpty { continue }
            if b.kind == .heading { titles.append(n); continue }
            // The first real paragraph: mute it if it just repeats a heading we already read.
            let seenHeading = blocks[..<i].contains { $0.kind == .heading && !$0.muted }
            if seenHeading, titles.contains(where: { !$0.isEmpty && ($0 == n || ($0.count > 8 && n.hasSuffix($0)) || ($0.count > 8 && $0.hasSuffix(n))) }) {
                blocks[i].muted = true
            }
            break
        }
    }

    // MARK: Notes

    private static let noteStart = try! NSRegularExpression(
        pattern: #"^\s*[\[(]?\s*(author|translator|editor|tl|t/l|a/n|t/n|[A-Z][a-z]+)['’]?s?\s*(note|n)\b\s*[:\-–—]|^\s*[\[(]?\s*(a/n|t/n|tl note|tl;?dr)\s*[:\-–—]"#,
        options: [.caseInsensitive])

    private static func muteNotes(_ blocks: inout [Block]) {
        let count = blocks.count
        var i = 0
        while i < count {
            let t = blocks[i].text
            guard blocks[i].kind == .paragraph,
                  noteStart.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) != nil,
                  t.lowercased().contains("note") || t.lowercased().hasPrefix("a/n") || t.lowercased().hasPrefix("t/n")
            else { i += 1; continue }
            blocks[i].muted = true
            let trimmed = t.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") || trimmed.hasPrefix("(") {
                // Bracketed note: mute until the closing bracket.
                let close: Character = trimmed.hasPrefix("[") ? "]" : ")"
                var j = i
                while j < count, !blocks[j].text.contains(close), j - i < 30 { blocks[j].muted = true; j += 1 }
                if j < count, j - i < 30 { blocks[j].muted = true }
                i = j + 1
            } else if Double(i) >= Double(count) * 0.6 {
                // Unbracketed note near the end: the rest of the chapter is the note.
                for j in i..<count where blocks[j].kind == .paragraph { blocks[j].muted = true }
                return
            } else {
                i += 1
            }
        }
    }

    // MARK: Watermarks

    /// Known scraper sites, including the spaced-out / hyphenated spellings they inject.
    private static let site = #"(?:f\s*r\s*e\s*e\s*w\s*e\s*b\s*n\s*o\s*v\s*e\s*l|free\s+web\s+novel|n\s*o\s*v\s*e\s*l\s*-?\s*b\s*-?\s*i\s*n|novel\s*next|light\s*novel\s*(?:world|pub|cave)|lib\s*read|web\s*novel\s*\.|novel\s*full|read\s*novel\s*full|discord\.gg/\S+|https?://\S+)"#
    /// Any token ending in ".com" (homoglyph domains like "ƒгeewebnovёl.com" included).
    private static let domain = #"(?:(?<!\S)\S+?\.\s?c\s?o\s?m\b\S?|(?<!\S)\S+\s\.\s?c\s?o\s?m\b)"#
    private static let watermark = try! NSRegularExpression(
        pattern: "(?:\(site)(?:\\s*\\.?\\s*-?\\s*c\\s*o\\s*m\\b)?|\(domain))", options: [.caseInsensitive])
    /// Phrases that mark a whole sentence as an advertisement.
    private static let notice = try! NSRegularExpression(
        pattern: #"support us|published on|read more chapters|faster update|steals content|boycott|pirated|official release|updated by|upload(?:s|ed)? daily|follow current novels|\bvisit\b|take a look at|other stuff on|reading this on|our discord|join us|\\bdiscord\\b|latest chapters|updates of your|^\\s*source:"#,
        options: [.caseInsensitive])
    private static let junkTag = try! NSRegularExpression(pattern: #"<\s*\.?\s*com\s*>|(?<=[.!?"”’])\.com\b|(?:\bcom\.){2,}(?:com\b)?|\.com\.com\.?"#, options: [.caseInsensitive])

    private static func stripWatermarks(_ blocks: inout [Block]) {
        for i in blocks.indices where blocks[i].kind == .paragraph || blocks[i].kind == .heading {
            var block = blocks[i]
            // 1. Stray "<.com>" tags glued to real sentences.
            let tags = junkTag.matches(in: block.text, range: NSRange(location: 0, length: (block.text as NSString).length)).map(\.range)
            if !tags.isEmpty { remove(merge(tags), from: &block) }

            // 2. Watermarks: cut the whole sentence if it's an ad ("Support us at …"), else just the site name.
            let text = block.text
            let full = NSRange(location: 0, length: (text as NSString).length)
            let marks = watermark.matches(in: text, range: full).map(\.range)
            var hadWatermark = false
            if !marks.isEmpty {
                hadWatermark = true
                let sents = sentences(text)
                var cuts: [NSRange] = []
                for m in marks {
                    if let sent = sents.first(where: { NSLocationInRange(m.location, $0) }),
                       notice.firstMatch(in: text, range: sent) != nil {
                        cuts.append(NSUnionRange(sent, m))
                    } else {
                        cuts.append(m)
                    }
                }
                remove(merge(cuts), from: &block)
            }
            guard block.text != blocks[i].text else { continue }

            let letters = block.text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
            let words = block.text.split(whereSeparator: { $0.isWhitespace }).count
            let leftoverAd = hadWatermark && notice.firstMatch(in: block.text, range: NSRange(location: 0, length: (block.text as NSString).length)) != nil && words < 14
            if letters < 3 || (words <= 1 && letters < 6) || leftoverAd {
                blocks[i].muted = true          // nothing real left: keep the original text, just don't read it
            } else {
                blocks[i] = block
            }
        }
    }

    private static func sentences(_ text: String) -> [NSRange] {
        let tok = NLTokenizer(unit: .sentence)
        tok.string = text
        return tok.tokens(for: text.startIndex..<text.endIndex).map { NSRange($0, in: text) }
    }

    private static func merge(_ ranges: [NSRange]) -> [NSRange] {
        let sorted = ranges.sorted { $0.location < $1.location }
        var out: [NSRange] = []
        for r in sorted {
            if let last = out.last, r.location <= NSMaxRange(last) {
                out[out.count - 1] = NSUnionRange(last, r)
            } else { out.append(r) }
        }
        return out
    }

    /// Removes ranges (sorted, non-overlapping) from the block text, keeping style runs aligned.
    private static func remove(_ ranges: [NSRange], from block: inout Block) {
        let ns = NSMutableString(string: block.text)
        var runs = block.runs
        for r in ranges.reversed() {
            ns.deleteCharacters(in: r)
            runs = runs.compactMap { run in
                var start = run.start, end = run.start + run.length
                func shift(_ x: Int) -> Int { x <= r.location ? x : (x >= NSMaxRange(r) ? x - r.length : r.location) }
                start = shift(start); end = shift(end)
                return end > start ? StyleRun(start: start, length: end - start, bold: run.bold, italic: run.italic) : nil
            }
        }
        // Tidy spacing left behind ("smiled: ." → "smiled:").
        var s = ns as String
        let before = s
        s = s.replacingOccurrences(of: #"\s+([.,!?;:’”])"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"^[\s.,;:\-–—]+"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
        s = s.trimmingCharacters(in: .whitespaces)
        if s != before { runs = [] }    // offsets moved; drop styling for this paragraph rather than misplace it
        block.text = s
        block.runs = runs
    }

    private static func normalize(_ s: String) -> String {
        String(s.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(Character.init))
    }
}
