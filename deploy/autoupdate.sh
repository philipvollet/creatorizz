#!/bin/bash
# Auto-update for the always-on Mac, run every minute by io.creatorizz.autoupdate (installed by
# install-macos.sh). When the branch this folder tracks (usually main) has new commits, it
# fast-forwards, runs npm ci and npm run check, and restarts the app; open dashboards then reload
# themselves. If anything fails it goes back to the previous commit, rebuilds, keeps the old
# version running, and skips that commit until a newer one arrives.
#
# It polls instead of listening for a GitHub webhook: one small request a minute, and nothing
# has to be reachable from the internet. It runs as the app's user, not root, and logs to
# data/autoupdate.log.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$APP_DIR/data"
LOG="$DATA/autoupdate.log"
STATE="$DATA/autoupdate.state"
MAX_LOG_BYTES=10485760

cd "$APP_DIR" || exit 1
mkdir -p "$DATA"
env_get() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
[[ "$(env_get AUTO_UPDATE)" == "on" ]] || exit 0  # off unless switched on; no reinstall needed
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
if [[ -f "$LOG" ]] && (( $(stat -f %z "$LOG") > MAX_LOG_BYTES )); then mv "$LOG" "$LOG.1"; fi

bad_sha=""; noted=""
[[ -f "$STATE" ]] && source "$STATE"
save() { printf 'bad_sha=%s\nnoted=%s\n' "$bad_sha" "$noted" > "$STATE"; }
# Logs a problem that would otherwise repeat every minute once per key (usually the new commit).
note_once() { [[ "$noted" == "$1" ]] && return; log "$2"; noted="$1"; save; }

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || { note_once no-upstream "the checked-out branch tracks no remote branch; nothing to follow"; exit 0; }
remote="${upstream%%/*}"; branch="${upstream#*/}"

# Cheap check first: one request for the remote branch's commit, no fetch.
remote_sha="$(git ls-remote "$remote" "refs/heads/$branch" 2>/dev/null | cut -f1)"
[[ -z "$remote_sha" ]] && exit 0  # offline or GitHub unreachable; try again next minute
local_sha="$(git rev-parse HEAD)"
[[ "$remote_sha" == "$local_sha" || "$remote_sha" == "$bad_sha" ]] && exit 0

PORT="$(env_get PORT)"; PORT="${PORT:-4410}"
if curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"collecting":true'; then
  exit 0  # don't cut a collection short; try again next minute
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  note_once "$remote_sha" "new commit ${remote_sha:0:7} on $upstream, but tracked files were changed locally (git status); not updating"
  exit 0
fi

git fetch -q "$remote" "$branch" 2>>"$LOG" || { log "fetch from $remote failed"; exit 0; }
if ! git merge-base --is-ancestor HEAD "$remote_sha"; then
  log "${remote_sha:0:7} on $upstream doesn't build on ${local_sha:0:7} (history rewritten?); not updating"
  bad_sha="$remote_sha"; save
  exit 0
fi

log "updating ${local_sha:0:7} -> ${remote_sha:0:7}:"
git log --format='    | %h %s' "HEAD..$remote_sha" >> "$LOG"
deploy_changed="$(git diff --name-only HEAD "$remote_sha" -- deploy/install-macos.sh deploy/uninstall-macos.sh)"

out="$DATA/autoupdate.last-output"
if git merge -q --ff-only "$remote_sha" > "$out" 2>&1 && npm ci >> "$out" 2>&1 && npm run check >> "$out" 2>&1; then
  pid=""
  for p in $(pgrep -u "$(id -u)" -f 'node server/index.ts'); do
    lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep -qx "n$APP_DIR" && pid="$p"
  done
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid"
    log "updated to ${remote_sha:0:7}; restarted the app (stopped pid $pid, launchd starts the new one)"
  else
    log "updated to ${remote_sha:0:7}; no app process was running (launchd starts it if the service is loaded)"
  fi
  [[ -n "$deploy_changed" ]] && log "the install scripts changed; run ./deploy/install-macos.sh once (needs sudo) to apply them"
  bad_sha=""; save
else
  log "update to ${remote_sha:0:7} failed; last lines of output:"
  tail -n 30 "$out" | sed 's/^/    | /' >> "$LOG"
  git reset -q --hard "$local_sha"
  if npm ci > "$out" 2>&1 && npm run build >> "$out" 2>&1; then
    log "rolled back to ${local_sha:0:7}; the running app was not restarted; will retry when $upstream moves on"
  else
    log "rolled back to ${local_sha:0:7} but its rebuild failed too (see $out); the running app keeps going until its next restart"
  fi
  bad_sha="$remote_sha"; save
fi
