#!/bin/zsh
# Regenerates the RemindMe icon. Run from anywhere; then run ../build.sh again.
set -e
cd "$(dirname "$0")/.."
mkdir -p Resources
swift tools/make-icon.swift
T=$(mktemp -d)/RemindMe.iconset; mkdir -p $T
for s in 16 32 128 256 512; do
  sips -z $s $s Resources/icon.png --out $T/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) Resources/icon.png --out $T/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns $T -o Resources/RemindMe.icns
echo "Icon updated."
