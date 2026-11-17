#!/bin/zsh
# Run hourly by launchd (see install-auto-reinstall.sh). Free developer installs expire after
# 7 days, so every 4 days this rebuilds Narrate and reinstalls it on the iPhone over Wi-Fi.
# It quietly retries every hour until the phone is reachable (same Wi-Fi, recently unlocked).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")"
STAMP="$HOME/Library/Application Support/Narrate/last-iphone-install"
NOW=$(date +%s)
LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
AGE_DAYS=$(( (NOW - LAST) / 86400 ))
(( AGE_DAYS < 4 )) && exit 0

echo "$(date): last install ${AGE_DAYS}d ago, reinstalling…"
if ./install-iphone.sh; then
  osascript -e 'display notification "Reinstalled on your iPhone. Good for another 7 days." with title "Narrate"' 2>/dev/null
else
  echo "$(date): iPhone not reachable, will retry next hour"
  if (( AGE_DAYS >= 6 )); then
    osascript -e 'display notification "Couldn’t reach your iPhone to renew Narrate. Unlock it on the same Wi-Fi, or plug it in." with title "Narrate expires soon"' 2>/dev/null
  fi
fi
