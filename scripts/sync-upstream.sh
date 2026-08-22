#!/usr/bin/env bash
# Re-vendor the upstream Hermes TypeScript from the agent host.
#
# Vendored code is never edited in place (§9). Adaptations wrap it in
# src/backends/hermes/. This script only ever overwrites vendor/hermes/, then
# records the ref it pulled from in vendor/hermes/UPSTREAM.md.
#
#   ./scripts/sync-upstream.sh [ssh-host] [remote-tree]
set -euo pipefail

SSH_HOST="${1:-hermes}"
TREE="${2:-.hermes/hermes-agent}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/hermes"

SHARED_FILES=(
  backend-scope billing-policy billing-types charge-settlement
  cron-trigger-controller index json-rpc-gateway skill-scaffold skin websocket-url
)

echo "Pulling upstream from $SSH_HOST:$TREE"
REF="$(ssh "$SSH_HOST" "cd $TREE && git rev-parse HEAD")"

mkdir -p "$DEST/shared" "$DEST/types" "$DEST/reference"

for file in "${SHARED_FILES[@]}"; do
  scp -q "$SSH_HOST:$TREE/apps/shared/src/$file.ts" "$DEST/shared/$file.ts"
done

scp -q "$SSH_HOST:$TREE/apps/desktop/src/types/hermes.ts" "$DEST/types/hermes.ts"
scp -q "$SSH_HOST:$TREE/apps/desktop/src/hermes.ts" "$DEST/reference/hermes-desktop-client.ts"

python3 - "$DEST/UPSTREAM.md" "$REF" <<'PY'
import re, sys, datetime
path, ref = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(r'(?m)^- \*\*Pinned ref:\*\*.*$', f'- **Pinned ref:** `{ref}`', text)
text = re.sub(r'(?m)^- \*\*Synced:\*\*.*$', f'- **Synced:** {datetime.date.today().isoformat()}', text)
open(path, 'w').write(text)
PY

echo "Synced at $REF. Run 'npm run typecheck' — an upstream break should surface here, not in someone's hand."
