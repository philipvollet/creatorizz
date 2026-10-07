#!/bin/bash
# Health watchdog for the io.creatorizz LaunchDaemon, run every 5 minutes by io.creatorizz.watchdog
# (installed by install-macos.sh). launchd already restarts the app when it exits; this covers the
# case where it is still running but no longer answers /api/health. After two failed checks in a
# row it stops the app's process, and launchd starts a fresh one.
#
# It runs as the app's user, not root, and logs to data/watchdog.log: every action, every state
# change, and one "ok" line a day. It also keeps data/creatorizz.log and its own log under 10 MB.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$APP_DIR/data"
LOG="$DATA/watchdog.log"
STATE="$DATA/watchdog.state"
APP_LOG="$DATA/creatorizz.log"
FAILS_BEFORE_RESTART=2
MIN_AGE_S=120          # leave a process this young alone; it may still be starting
RESTART_GAP_S=1800     # at most one restart per 30 minutes, so a cause outside the app (firewall,
                       # network) does not turn into a restart loop
MAX_LOG_BYTES=10485760

mkdir -p "$DATA"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Keep logs bounded. The app's log is held open by launchd in append mode, so copy then truncate.
rotate() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if (( $(stat -f %z "$f") > MAX_LOG_BYTES )); then
    cp "$f" "$f.1" && : > "$f"
    log "rotated $(basename "$f") to $(basename "$f").1"
  fi
}
rotate "$APP_LOG"
rotate "$LOG"

env_get() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
HOST="$(env_get HOST)"; HOST="${HOST:-127.0.0.1}"
PORT="$(env_get PORT)"; PORT="${PORT:-4410}"
# The app also listens on loopback when HOST is a network address (see server/index.ts), and a
# NetBird peer in userspace mode cannot reach its own NetBird IP, so check over loopback.
URL="http://127.0.0.1:$PORT/api/health"

fails=0; last_ok_day=""; last_restart=0
[[ -f "$STATE" ]] && source "$STATE"
save() { printf 'fails=%d\nlast_ok_day=%s\nlast_restart=%d\n' "$fails" "$last_ok_day" "$last_restart" > "$STATE"; }

# The app's node process: the one running server/index.ts with this folder as its working dir.
app_pid() {
  local pid
  for pid in $(pgrep -u "$(id -u)" -f 'node server/index.ts'); do
    if lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qx "n$APP_DIR"; then echo "$pid"; return; fi
  done
}

# Seconds since a process started, from ps's [[dd-]hh:]mm:ss.
age_s() {
  local t d=0 h=0 m=0 s=0
  t="$(ps -o etime= -p "$1" | tr -d ' ')"
  [[ "$t" == *-* ]] && { d="${t%%-*}"; t="${t#*-}"; }
  IFS=: read -r a b c <<< "$t"
  if [[ -n "$c" ]]; then h=$a; m=$b; s=$c; else m=$a; s=$b; fi
  echo $(( 10#$d*86400 + 10#$h*3600 + 10#$m*60 + 10#$s ))
}

if body="$(curl -fsS --max-time 10 "$URL" 2>&1)"; then
  (( fails > 0 )) && log "recovered after $fails failed check(s): $body"
  today="$(date +%F)"
  [[ "$last_ok_day" != "$today" ]] && log "ok $body"
  fails=0; last_ok_day="$today"; save
  exit 0
fi

# If the address to serve on is not on this machine (e.g. NetBird is down), the app can't bind it
# and launchd keeps retrying; restarting won't help.
if [[ "$HOST" != "127.0.0.1" ]] && ! ifconfig | grep -q "inet $HOST "; then
  log "health check failed and $HOST is not on any interface (NetBird down?); not restarting"
  exit 0
fi

fails=$(( fails + 1 )); save
pid="$(app_pid)"
log "health check failed ($fails/$FAILS_BEFORE_RESTART) $URL: $body; pid=${pid:-none}"

if [[ -z "$pid" ]]; then
  # Nothing running: launchd restarts it on its own (every 30s at most) if the service is loaded.
  # A service that was unloaded needs sudo: ./deploy/install-macos.sh
  (( fails >= FAILS_BEFORE_RESTART )) && log "no app process; if this repeats, check that the service is loaded (sudo launchctl print system/io.creatorizz)"
  exit 0
fi

(( fails < FAILS_BEFORE_RESTART )) && exit 0
age="$(age_s "$pid")"
if (( age < MIN_AGE_S )); then log "pid $pid is only ${age}s old; waiting"; exit 0; fi

now="$(date +%s)"
if (( now - last_restart < RESTART_GAP_S )); then
  log "would restart, but the last restart was $(( now - last_restart ))s ago; the cause may be outside the app (firewall? see README)"
  exit 0
fi
log "restarting: stopping pid $pid (up ${age}s); last lines of creatorizz.log:"
tail -n 20 "$APP_LOG" 2>/dev/null | sed 's/^/    | /' >> "$LOG"
kill -TERM "$pid" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null; log "pid $pid ignored SIGTERM; sent SIGKILL"; fi
log "pid $pid stopped; launchd starts a new one"
fails=0; last_restart="$now"; save
