#!/bin/bash
# Stops creatorizz and removes its LaunchDaemon. The app folder and its data are left alone.
set -euo pipefail
LABEL="io.creatorizz"
sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
sudo rm -f "/Library/LaunchDaemons/$LABEL.plist"
echo "creatorizz service removed"
