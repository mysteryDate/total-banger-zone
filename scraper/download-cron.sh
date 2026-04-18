#!/bin/bash
# Cron wrapper for downloading audio for new tracks.
# Run frequently (every 5-15 min) — exits immediately if nothing to do.
#
# Usage: crontab -e
#   */10 * * * * /path/to/total-banger-zone/scraper/download-cron.sh >> /tmp/tbz-download.log 2>&1

set -euo pipefail

# Cron runs with a minimal PATH — load nvm and add user-local tool dirs
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cron tick"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

git pull --rebase --quiet

# Exit early if no tracks need downloading
node -e "
  const t = JSON.parse(require('fs').readFileSync('tracks.json','utf8'));
  const pending = t.filter(x => !x.audioUrl && !x.downloadError && !x.skip && x.subtype !== 'album' && x.subtype !== 'playlist');
  if (pending.length === 0) process.exit(1);
  console.log(pending.length + ' tracks pending download');
" || exit 0

cd scraper
node download.mjs
cd ..

git add tracks.json
git diff --cached --quiet || git commit -m "Add audio $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push --quiet
