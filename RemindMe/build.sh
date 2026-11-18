#!/bin/zsh
# Builds RemindMe.app (a few MB, no Xcode project needed) into RemindMe/build.
#   ./build.sh            build only
#   ./build.sh install    build, copy to /Applications and (re)start it
set -e
cd "$(dirname "$0")"
APP=build/RemindMe.app
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/RemindMe" Sources/main.swift -framework AppKit -framework SwiftUI -framework ServiceManagement
[[ -f Resources/RemindMe.icns ]] && cp Resources/RemindMe.icns "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>RemindMe</string>
  <key>CFBundleDisplayName</key><string>RemindMe</string>
  <key>CFBundleIdentifier</key><string>com.wastella.remindme</string>
  <key>CFBundleExecutable</key><string>RemindMe</string>
  <key>CFBundleIconFile</key><string>RemindMe</string>
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
  pkill -x RemindMe 2>/dev/null || true
  rm -rf /Applications/RemindMe.app && cp -R "$APP" /Applications/
  open /Applications/RemindMe.app
  echo "Installed /Applications/RemindMe.app and started it (look for the bell in the menu bar)."
fi
