// Draws the RemindMe icon from the Me icon itself (../build/icon.png), so the "Me" lettering is
// pixel-for-pixel the same and sits in the same place. Only the background color changes, and a
// bell is added underneath. Run tools/make-icon.sh (it also rebuilds the .icns).
import AppKit

let background = (r: 0xd9, g: 0x8a, b: 0x06)   // RemindMe amber
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

// A bell under the wordmark: dome, rim and clapper.
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.white.setStroke(); NSColor.white.setFill()
let cx: CGFloat = 518.5, rim: CGFloat = 176, top: CGFloat = 300
let bell = NSBezierPath()
bell.move(to: NSPoint(x: cx - 118, y: rim))
bell.line(to: NSPoint(x: cx + 118, y: rim))
bell.move(to: NSPoint(x: cx - 84, y: rim))
bell.curve(to: NSPoint(x: cx, y: top), controlPoint1: NSPoint(x: cx - 84, y: rim + 80), controlPoint2: NSPoint(x: cx - 70, y: top))
bell.curve(to: NSPoint(x: cx + 84, y: rim), controlPoint1: NSPoint(x: cx + 70, y: top), controlPoint2: NSPoint(x: cx + 84, y: rim + 80))
bell.lineWidth = 40
bell.lineCapStyle = .round
bell.lineJoinStyle = .round
bell.stroke()
NSBezierPath(ovalIn: NSRect(x: cx - 24, y: rim - 62, width: 48, height: 48)).fill()
NSGraphicsContext.current = nil

try! rep.representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: "Resources/icon.png"))
