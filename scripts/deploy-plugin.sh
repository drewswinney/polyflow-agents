#!/usr/bin/env bash
# Install the handheld-push plugin onto the agent host.
#
# Mirrors sync-upstream.sh in the other direction: that pulls Hermes's types
# down, this pushes our plugin up. The plugin is versioned here because it and
# the app share a contract (§3 of docs/push-relay.md) and drift between them is
# invisible until a notification silently stops arriving.
#
#   ./scripts/deploy-plugin.sh [ssh-host]
set -euo pipefail

SSH_HOST="${1:-hermes}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/host/handheld-push"
DEST=".hermes/plugins/handheld-push"

echo "Deploying handheld-push to $SSH_HOST:$DEST"
ssh "$SSH_HOST" "mkdir -p $DEST/dashboard"
scp -q "$SRC"/*.py "$SRC"/plugin.yaml "$SSH_HOST:$DEST/"
# `dashboard/` is what the web server discovers: manifest.json names the api
# file, and without both there are no registration routes.
scp -q "$SRC"/dashboard/manifest.json "$SRC"/dashboard/plugin_api.py "$SSH_HOST:$DEST/dashboard/"

# Stale bytecode from a previous version outlives the source it came from.
ssh "$SSH_HOST" "rm -rf $DEST/__pycache__ $DEST/dashboard/__pycache__"

cat <<'NOTE'

Deployed. Two things stand between this and working.

1. Enable it. A user plugin's Python is not imported until its name is in the
   `plugins.enabled` allow-list — an installed-but-not-enabled plugin running
   code at startup is the vector GHSA-mcfc-hp25-cjv7 closed.

     ssh HOST 'hermes plugins enable handheld-push'

2. Restart the processes that load it:

     hermes serve        — hooks (approvals, clarify, artifacts) AND the
                           registration routes, which mount at import
     hermes gateway      — the platform face (cron delivery only)

   `/api/dashboard/plugins/rescan` re-scans the plugin *list* and reloads
   JS/CSS, but `_mount_plugin_api_routes()` runs at module import, so a new or
   changed backend route needs the restart.

Then confirm both faces:

  ssh HOST 'hermes plugins list | grep handheld'
  curl -H "Authorization: Bearer $TOKEN" http://HOST:9119/api/plugins/handheld-push/devices
NOTE
