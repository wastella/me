#!/bin/zsh
# Installs a launchd job that keeps MeReader from expiring on your iPhone. Undo with:
#   launchctl bootout gui/$(id -u)/com.mereader.reinstall; rm ~/Library/LaunchAgents/com.mereader.reinstall.plist
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mereader.reinstall.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mereader.reinstall</string>
  <key>ProgramArguments</key><array><string>$DIR/auto-reinstall.sh</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/MeReader-reinstall.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/MeReader-reinstall.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.mereader.reinstall" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Auto-reinstall is on (checks hourly; reinstalls every 4 days)."
