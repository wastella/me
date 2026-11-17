#!/bin/zsh
# Builds MeReader and installs it on your iPhone (plug it in, or have it on the same Wi-Fi).
# Free Apple developer accounts: the app stops opening after 7 days — just run this again.
set -e
cd "$(dirname "$0")"
command -v xcodegen >/dev/null && xcodegen generate >/dev/null
DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && $0 !~ /unavailable/ {for(i=1;i<=NF;i++) if ($i ~ /^[0-9A-F-]{36}$/) {print $i; exit}}')
if [[ -z "$DEVICE" ]]; then
  echo "No iPhone found. Plug it in with a cable (and tap Trust), then run this again."; exit 1
fi
# Build output lives on the external SSD when it's plugged in (the internal disk is nearly full).
DD="build/device"; [[ -d /Volumes/T7 ]] && DD="/Volumes/T7/MeReaderBuild/dd-device"
echo "Building for iPhone $DEVICE…"
xcodebuild -project MeReader.xcodeproj -scheme MeReader -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath "$DD" \
  -allowProvisioningUpdates -quiet COMPILER_INDEX_STORE_ENABLE=NO build
xcrun devicectl device install app --device "$DEVICE" "$DD"/Build/Products/Release-iphoneos/MeReader.app
# Remember when we last installed, so the background job knows when the 7 days are nearly up.
mkdir -p "$HOME/Library/Application Support/Narrate" && date +%s > "$HOME/Library/Application Support/Narrate/last-iphone-install"
echo "Installed. First time only: on the iPhone go to Settings → General → VPN & Device Management → trust your developer profile."
