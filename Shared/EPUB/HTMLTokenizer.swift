import Foundation

/// A forgiving tag tokenizer for (X)HTML / XML. EPUBs in the wild are frequently
/// not well-formed XML (HTML entities, unclosed tags), so we don't use XMLParser.
enum HTMLToken {
    case open(name: String, attrs: [String: String], selfClosing: Bool)
    case close(name: String)
    case text(String)
}

enum HTMLTokenizer {
    static func tokenize(_ data: Data, _ emit: (HTMLToken) -> Void) {
        let bytes = [UInt8](data)
        let n = bytes.count
        var i = 0
        var textStart = 0

        func flushText(_ end: Int) {
            if end > textStart {
                let s = String(decoding: bytes[textStart..<end], as: UTF8.self)
                emit(.text(decodeEntities(s)))
            }
        }

        func hasPrefix(_ p: [UInt8], at idx: Int) -> Bool {
            guard idx + p.count <= n else { return false }
            for k in 0..<p.count where bytes[idx + k] != p[k] { return false }
            return true
        }

        func find(_ p: [UInt8], from idx: Int) -> Int? {
            var j = idx
            while j + p.count <= n {
                if bytes[j] == p[0] && hasPrefix(p, at: j) { return j }
                j += 1
            }
            return nil
        }

        let commentOpen = Array("<!--".utf8), commentClose = Array("-->".utf8)
        let cdataOpen = Array("<![CDATA[".utf8), cdataClose = Array("]]>".utf8)

        while i < n {
            guard bytes[i] == UInt8(ascii: "<") else { i += 1; continue }
            if hasPrefix(commentOpen, at: i) {
                flushText(i)
                i = (find(commentClose, from: i + 4) ?? n - 3) + 3
                textStart = i
                continue
            }
            if hasPrefix(cdataOpen, at: i) {
                flushText(i)
                let end = find(cdataClose, from: i + 9) ?? n
                emit(.text(String(decoding: bytes[(i + 9)..<end], as: UTF8.self)))
                i = min(n, end + 3)
                textStart = i
                continue
            }
            // Find end of tag, respecting quotes.
            var j = i + 1
            var quote: UInt8 = 0
            while j < n {
                let c = bytes[j]
                if quote != 0 { if c == quote { quote = 0 } }
                else if c == UInt8(ascii: "\"") || c == UInt8(ascii: "'") { quote = c }
                else if c == UInt8(ascii: ">") { break }
                j += 1
            }
            guard j < n else { break }
            let next = i + 1 < n ? bytes[i + 1] : 0
            let isTagStart = (next >= 65 && next <= 90) || (next >= 97 && next <= 122) || next == UInt8(ascii: "/") || next == UInt8(ascii: "!") || next == UInt8(ascii: "?")
            if !isTagStart { i += 1; continue } // a literal "<" in text
            flushText(i)
            let inner = String(decoding: bytes[(i + 1)..<j], as: UTF8.self)
            i = j + 1
            textStart = i
            if inner.hasPrefix("!") || inner.hasPrefix("?") { continue }
            if inner.hasPrefix("/") {
                emit(.close(name: localName(String(inner.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines))))
                continue
            }
            var body = Substring(inner)
            var selfClosing = false
            if body.hasSuffix("/") { selfClosing = true; body = body.dropLast() }
            let nameEnd = body.firstIndex(where: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" }) ?? body.endIndex
            let name = localName(String(body[..<nameEnd]))
            let attrs = parseAttributes(body[nameEnd...])
            emit(.open(name: name, attrs: attrs, selfClosing: selfClosing))
        }
        flushText(n)
    }

    /// Lowercased tag name with any namespace prefix removed ("dc:title" -> "title").
    static func localName(_ raw: String) -> String {
        let lower = raw.lowercased()
        if let colon = lower.lastIndex(of: ":") { return String(lower[lower.index(after: colon)...]) }
        return lower
    }

    static func parseAttributes(_ s: Substring) -> [String: String] {
        var attrs: [String: String] = [:]
        let chars = Array(s)
        var i = 0
        let n = chars.count
        while i < n {
            while i < n && chars[i].isWhitespace { i += 1 }
            let ks = i
            while i < n && chars[i] != "=" && !chars[i].isWhitespace { i += 1 }
            let key = String(chars[ks..<i]).lowercased()
            while i < n && chars[i].isWhitespace { i += 1 }
            var value = ""
            if i < n && chars[i] == "=" {
                i += 1
                while i < n && chars[i].isWhitespace { i += 1 }
                if i < n && (chars[i] == "\"" || chars[i] == "'") {
                    let q = chars[i]; i += 1
                    let vs = i
                    while i < n && chars[i] != q { i += 1 }
                    value = String(chars[vs..<min(i, n)])
                    i += 1
                } else {
                    let vs = i
                    while i < n && !chars[i].isWhitespace { i += 1 }
                    value = String(chars[vs..<i])
                }
            }
            if !key.isEmpty { attrs[key] = decodeEntities(value) }
        }
        return attrs
    }

    static let named: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ",
        "mdash": "—", "ndash": "–", "hellip": "…", "lsquo": "‘", "rsquo": "’",
        "ldquo": "“", "rdquo": "”", "copy": "©", "reg": "®", "trade": "™",
        "shy": "", "zwj": "", "zwnj": "", "middot": "·", "bull": "•", "laquo": "«",
        "raquo": "»", "times": "×", "deg": "°", "eacute": "é", "egrave": "è",
        "aacute": "á", "agrave": "à", "uuml": "ü", "ouml": "ö", "auml": "ä",
        "ccedil": "ç", "ntilde": "ñ", "iexcl": "¡", "iquest": "¿", "thinsp": " ",
        "ensp": " ", "emsp": " ", "prime": "′", "Prime": "″", "sect": "§", "para": "¶",
    ]

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = ""
        out.reserveCapacity(s.count)
        var idx = s.startIndex
        while idx < s.endIndex {
            let c = s[idx]
            if c == "&", let semi = s[idx...].prefix(12).firstIndex(of: ";") {
                let entity = s[s.index(after: idx)..<semi]
                var replacement: String?
                if entity.hasPrefix("#x") || entity.hasPrefix("#X") {
                    if let v = UInt32(entity.dropFirst(2), radix: 16), let u = Unicode.Scalar(v) { replacement = String(Character(u)) }
                } else if entity.hasPrefix("#") {
                    if let v = UInt32(entity.dropFirst()), let u = Unicode.Scalar(v) { replacement = String(Character(u)) }
                } else {
                    replacement = named[String(entity)]
                }
                if let r = replacement {
                    out += r
                    idx = s.index(after: semi)
                    continue
                }
            }
            out.append(c)
            idx = s.index(after: idx)
        }
        return out
    }
}
