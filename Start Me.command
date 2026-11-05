#!/bin/zsh
# Double-click to start Me and open it in your browser.
cd "$(dirname "$0")"
if ! curl -s -o /dev/null http://localhost:3737; then
  [ -d .next ] || npm run build
  (sleep 2 && open http://localhost:3737) &
  npm start
else
  open http://localhost:3737
fi
