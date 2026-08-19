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
ssh "$SSH_HOST" "mkdir -p $DEST"
scp -q "$SRC"/*.py "$SRC"/plugin.yaml "$SSH_HOST:$DEST/"

# Stale bytecode from a previous version outlives the source it came from.
ssh "$SSH_HOST" "rm -rf $DEST/__pycache__"

cat <<'NOTE'

Deployed. It is not live until the processes that load plugins restart:

  hermes serve        — the hooks (approvals, clarify, artifacts)
  hermes gateway      — the platform face (cron delivery, device registration)

Then confirm discovery:

  ssh HOST 'hermes plugins list | grep handheld'
NOTE
