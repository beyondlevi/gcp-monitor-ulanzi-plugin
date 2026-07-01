#!/usr/bin/env sh
#
# Build the installable .ulanziPlugin zip with runtime dependencies bundled.
# Usage: sh scripts/package.sh   (or ./scripts/package.sh)
#
set -eu

PLUGIN="com.ulanzi.gcpmonitor.ulanziPlugin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Installing runtime dependencies"
( cd "$ROOT/$PLUGIN" && npm install --omit=dev )

echo "==> Creating $PLUGIN.zip"
cd "$ROOT"
rm -f "$PLUGIN.zip"
zip -r -q "$PLUGIN.zip" "$PLUGIN" -x '*/.DS_Store' '*/__MACOSX/*'

echo "==> Done: $ROOT/$PLUGIN.zip"
