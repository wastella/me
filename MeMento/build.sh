#!/bin/zsh
# Builds MeMento.app (a few MB, no Xcode project needed) into MeMento/build.
#   ./build.sh            build only
#   ./build.sh install    build, copy to /Applications and (re)start it
set -e
cd "$(dirname "$0")"
APP=build/MeMento.app
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/MeMento" Sources/main.swift -framework AppKit -framework SwiftUI -framework ServiceManagement
[[ -f Resources/MeMento.icns ]] && cp Resources/MeMento.icns "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MeMento</string>
  <key>CFBundleDisplayName</key><string>MeMento</string>
  <key>CFBundleIdentifier</key><string>com.wastella.memento</string>
  <key>CFBundleExecutable</key><string>MeMento</string>
  <key>CFBundleIconFile</key><string>MeMento</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PL
codesign --force --sign - "$APP" 2>/dev/null
echo "Built $APP"
if [[ "$1" == "install" ]]; then
  pkill -x MeMento 2>/dev/null || true
  rm -rf /Applications/MeMento.app && cp -R "$APP" /Applications/
  open /Applications/MeMento.app
  echo "Installed /Applications/MeMento.app and started it (look for the bell in the menu bar)."
fi
