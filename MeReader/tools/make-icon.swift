// Draws the MeReader icon: the Me mark (coral square, bold white "Me") with an open book
// under the wordmark. Run: swift tools/make-icon.swift   (writes into Assets.xcassets)
import AppKit

func render(to path: String) {
    let s: CGFloat = 1024
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(s), pixelsHigh: Int(s), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    // A full, opaque square: the system rounds the corners. Don't draw rounded corners here:
    // macOS 26 adds a glass effect to icons with transparent corners, which tints the white.
    NSColor(srgbRed: 0xd1 / 255, green: 0x49 / 255, blue: 0x2e / 255, alpha: 1).setFill()   // same as Me's icon
    NSRect(x: 0, y: 0, width: s, height: s).fill()

    // "Me", same weight and tracking as the Me icon, lifted to make room for the book.
    let font = NSFont(name: "Helvetica-Bold", size: 460)!   // the letterforms of the Me icon
    let text = NSAttributedString(string: "Me", attributes: [.font: font, .foregroundColor: NSColor.white, .kern: -16])
    let size = text.size()
    let baselineFromTop: CGFloat = 590
    text.draw(at: NSPoint(x: (s - size.width) / 2 + 8, y: s - baselineFromTop + font.descender))

    // Open book: two pages meeting at a spine, as wide as the wordmark.
    let book = NSBezierPath()
    let y: CGFloat = s - 742, dip: CGFloat = 78
    book.move(to: NSPoint(x: 226, y: y))
    book.curve(to: NSPoint(x: 519, y: y - dip), controlPoint1: NSPoint(x: 330, y: y + 34), controlPoint2: NSPoint(x: 450, y: y + 6))
    book.curve(to: NSPoint(x: 812, y: y), controlPoint1: NSPoint(x: 588, y: y + 6), controlPoint2: NSPoint(x: 708, y: y + 34))
    book.lineWidth = 50
    book.lineCapStyle = .round
    book.lineJoinStyle = .round
    NSColor.white.setStroke()
    book.stroke()

    NSGraphicsContext.current = nil
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

// One image for both: the iPhone asset catalog, and the Mac's plain .icns
// (macOS/Resources/MeReader.icns, built from this PNG by tools/make-icon.sh).
render(to: "Shared/Assets.xcassets/AppIcon.appiconset/icon.png")
