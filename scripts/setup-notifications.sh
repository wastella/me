#!/bin/zsh
# One-time setup for Me notifications. Run from ~/Me:  zsh scripts/setup-notifications.sh
# Creates the push keys and the scheduler secret, stores them in Vercel and
# GitHub, and redeploys. Nothing secret is printed or saved to disk.
set -euo pipefail
cd "$(dirname "$0")/.."
V="npx --yes vercel@65.12.1"

echo "1/4  Creating notification keys…"
keys=$(npx --yes web-push@3.6.7 generate-vapid-keys --json)
pub=$(print -r -- "$keys" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).publicKey))')
priv=$(print -r -- "$keys" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).privateKey))')
cron=$(openssl rand -hex 32)

echo "2/4  Saving them in Vercel…"
for pair in "VAPID_PUBLIC_KEY:$pub" "VAPID_PRIVATE_KEY:$priv" "VAPID_SUBJECT:https://me-omega-green.vercel.app" "CRON_SECRET:$cron"; do
  name=${pair%%:*}; value=${pair#*:}
  $V env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | $V env add "$name" --environment production >/dev/null
  echo "     ✓ $name"
done

echo "3/4  Saving the scheduler secret in GitHub…"
printf '%s' "$cron" | gh secret set CRON_SECRET --repo wastella/me
echo "     ✓ CRON_SECRET"

echo "4/4  Deploying…"
$V deploy --prod --yes >/dev/null
echo "Done. Open Me on your iPhone (home-screen app) → Settings → Notifications → Turn on."
