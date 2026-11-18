// Draws the MeReader icon from the Me icon itself (../build/icon.png), so the "Me" lettering is
// pixel-for-pixel the same and sits in the same place. Only the background color changes, and an
// open book is added underneath. Run tools/make-icon.sh (it also rebuilds the Mac .icns).
import AppKit

let background = (r: 0x2f, g: 0x63, b: 0xc8)   // MeReader blue (the dashboard's --link blue)
let meCoral = (r: 0xd1, g: 0x49, b: 0x2e)      // background of the Me icon

let src = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: "../build/icon.png")))!
let s = 1024
precondition(src.pixelsWide == s && src.pixelsHigh == s, "expected the 1024px Me icon")
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: s, pixelsHigh: s, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
let i = src.bitmapData!, o = rep.bitmapData!, bpp = src.bitsPerPixel / 8

// Recolor: every pixel of the Me icon is a blend of coral and white. Keep the blend, swap the coral.
// The Me icon's corners are white outside its rounded square; here the whole square is background
// (the system rounds the corners, and an opaque square avoids macOS 26's glass effect on the white).
for y in 0..<s {
    for x in 0..<s {
        let p = y * src.bytesPerRow + x * bpp, q = y * rep.bytesPerRow + x * 4
        let inLetters = (300..<700).contains(y) && (180..<850).contains(x)
        var t = 0.0
        if inLetters {
            let tr = Double(Int(i[p]) - meCoral.r) / Double(255 - meCoral.r)
            let tg = Double(Int(i[p + 1]) - meCoral.g) / Double(255 - meCoral.g)
            let tb = Double(Int(i[p + 2]) - meCoral.b) / Double(255 - meCoral.b)
            t = min(1, max(0, (tr + tg + tb) / 3))
        }
        o[q] = UInt8(Double(background.r) + (255 - Double(background.r)) * t)
        o[q + 1] = UInt8(Double(background.g) + (255 - Double(background.g)) * t)
        o[q + 2] = UInt8(Double(background.b) + (255 - Double(background.b)) * t)
        o[q + 3] = 255
    }
}

// Open book under the wordmark: two pages meeting at a spine, as wide as the "Me".
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let book = NSBezierPath()
let top: CGFloat = CGFloat(s) - 778, dip: CGFloat = 70
book.move(to: NSPoint(x: 240, y: top))
book.curve(to: NSPoint(x: 518.5, y: top - dip), controlPoint1: NSPoint(x: 340, y: top + 30), controlPoint2: NSPoint(x: 452, y: top + 4))
book.curve(to: NSPoint(x: 797, y: top), controlPoint1: NSPoint(x: 585, y: top + 4), controlPoint2: NSPoint(x: 697, y: top + 30))
book.lineWidth = 46
book.lineCapStyle = .round
book.lineJoinStyle = .round
NSColor.white.setStroke()
book.stroke()
NSGraphicsContext.current = nil

try! rep.representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: "Shared/Assets.xcassets/AppIcon.appiconset/icon.png"))
