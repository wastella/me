#!/bin/zsh
# Regenerates the MeReader icon for iPhone and Mac. Run from the MeReader folder.
set -e
cd "$(dirname "$0")/.."
swift tools/make-icon.swift
PNG=Shared/Assets.xcassets/AppIcon.appiconset/icon.png
T=$(mktemp -d)/MeReader.iconset; mkdir -p $T
for s in 16 32 128 256 512; do
  sips -z $s $s $PNG --out $T/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) $PNG --out $T/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns $T -o macOS/Resources/MeReader.icns
echo "Icon updated."
