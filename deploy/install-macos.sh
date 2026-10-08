#!/bin/bash
# Installs creatorizz as a macOS LaunchDaemon: it starts at boot (no login needed), runs as
# the user who runs this script, and is restarted if it ever stops. Run from the app folder:
#   ./deploy/install-macos.sh
# Re-running it updates the service (e.g. after a git pull and npm run build).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="io.creatorizz"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
NODE="$(command -v node || true)"
RUN_AS="$(id -un)"

if [[ -z "$NODE" ]]; then echo "node not found; install Node 24 or newer first" >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if (( MAJOR < 24 )); then echo "Node $MAJOR found; creatorizz needs Node 24 or newer" >&2; exit 1; fi
if [[ ! -f "$APP_DIR/.env" ]]; then echo "missing $APP_DIR/.env (copy .env.example and fill it in)" >&2; exit 1; fi
if [[ ! -f "$APP_DIR/config.json" ]]; then echo "missing $APP_DIR/config.json (see README, \"Who is tracked\")" >&2; exit 1; fi
if [[ ! -f "$APP_DIR/web/dist/index.html" ]]; then echo "no dashboard build yet; run: npm ci && npm run build" >&2; exit 1; fi

mkdir -p "$APP_DIR/data"

TMP="$(mktemp)"
cat > "$TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$RUN_AS</string>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>server/index.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$APP_DIR/data/creatorizz.log</string>
  <key>StandardErrorPath</key><string>$APP_DIR/data/creatorizz.log</string>
</dict>
</plist>
PLIST

echo "Installing $PLIST (needs sudo)"
sudo cp "$TMP" "$PLIST"
rm "$TMP"
sudo chown root:wheel "$PLIST"
sudo chmod 644 "$PLIST"
sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST"
sudo launchctl enable "system/$LABEL"

# A script launchd runs every <seconds> as the same user: periodic_job <label> <script> <seconds>
periodic_job() {
  local label="$1" script="$2" every="$3" plist="/Library/LaunchDaemons/$1.plist" log tmp
  log="$APP_DIR/data/$(basename "$script" .sh).log"
  chmod +x "$APP_DIR/$script"
  tmp="$(mktemp)"
  cat > "$tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>UserName</key><string>$RUN_AS</string>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/$script</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>$every</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST
  sudo cp "$tmp" "$plist"
  rm "$tmp"
  sudo chown root:wheel "$plist"
  sudo chmod 644 "$plist"
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  sudo launchctl bootstrap system "$plist"
  sudo launchctl enable "system/$label"
}

# Watchdog: every 5 minutes, restarts the app if it is running but not answering /api/health.
periodic_job "$LABEL.watchdog" deploy/watchdog.sh 300
# Auto-update: every minute, follows the tracked branch when AUTO_UPDATE=on in .env (off otherwise).
periodic_job "$LABEL.autoupdate" deploy/autoupdate.sh 60

sleep 3
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || true)"; PORT="${PORT:-4410}"
HOST="$(grep -E '^HOST=' "$APP_DIR/.env" | cut -d= -f2 || true)"; HOST="${HOST:-127.0.0.1}"
# Checked over loopback (the app also listens there); a NetBird peer in userspace mode cannot
# reach its own NetBird IP.
if curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "creatorizz is running on http://$HOST:$PORT (logs in $APP_DIR/data/)"
else
  echo "creatorizz did not answer yet; see $APP_DIR/data/creatorizz.log"
fi
cat <<NOTE

So the daily run isn't missed, keep the Mac from sleeping and have it come back after a
power cut (these change system settings, so they are not run for you):
  sudo pmset -a sleep 0 disksleep 0 autorestart 1
NOTE
