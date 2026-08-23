#!/usr/bin/env bash
# Push the working copy of the plugin onto a host, for the edit/reload loop.
#
# This is the *development* path. What other people use is pip:
#
#   pip install polyflow-agents-push
#   polyflow_agents_push install --enable
#
# Both end at the same place — a `polyflow_agents_push` directory under
# ~/.hermes/plugins — but pip links the installed package there and upgrades
# with `pip install -U`, while this copies whatever is in the tree right now.
# Use this when iterating; tell users the pip route.
#
#   ./scripts/deploy-plugin.sh [ssh-host]
set -euo pipefail

SSH_HOST="${1:-hermes}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/host/polyflow_agents_push"
DEST=".hermes/plugins/polyflow_agents_push"

echo "Deploying polyflow_agents_push to $SSH_HOST:$DEST"

# A pip install leaves a symlink here. Copying onto it would write through into
# site-packages and leave the two silently disagreeing about which is live.
if ssh "$SSH_HOST" "test -L $DEST"; then
  echo "  $DEST is a symlink (pip install). Remove it first, or iterate with pip:" >&2
  echo "    polyflow_agents_push uninstall" >&2
  exit 1
fi

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

     ssh HOST 'hermes plugins enable polyflow_agents_push'

2. Restart the processes that load it:

     hermes serve        hooks (approvals, clarify, artifacts) AND the
                         registration routes, which mount at import
     hermes gateway      the platform face (cron delivery only)

   `/api/dashboard/plugins/rescan` re-scans the plugin list and reloads
   JS/CSS, but `_mount_plugin_api_routes()` runs at module import, so a new or
   changed backend route needs the restart.

Then confirm both faces:

  ssh HOST 'hermes plugins list | grep polyflow'
  curl -H "Authorization: Bearer $TOKEN" http://HOST:9119/api/plugins/polyflow_agents_push/devices
NOTE
