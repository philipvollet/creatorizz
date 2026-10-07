#!/bin/bash
# Stops creatorizz and removes its LaunchDaemon. The app folder and its data are left alone.
set -euo pipefail
LABEL="io.creatorizz"
for L in "$LABEL.watchdog" "$LABEL"; do
  sudo launchctl bootout "system/$L" 2>/dev/null || true
  sudo rm -f "/Library/LaunchDaemons/$L.plist"
done
echo "creatorizz service and its watchdog removed"
