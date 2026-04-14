#!/usr/bin/env bash
set -euo pipefail

# Release a new OTA bundle for the OtaKit demo app.
#
# Usage:
#   ./release.sh                        # patch bump, local server, base channel
#   ./release.sh --remote               # use production server
#   ./release.sh --version 0.4.0        # explicit version
#   ./release.sh --channel production   # target a specific channel
#
# Required env vars:
#   OTAKIT_TOKEN   — OtaKit API key
#
# The app ID and build dir are read from capacitor.config.ts automatically.

cd "$(dirname "$0")"

LOCAL_URL="http://localhost:3000"
REMOTE_URL="https://otakit.app"
SERVER_URL="$LOCAL_URL"
CHANNEL=""
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)   SERVER_URL="$REMOTE_URL"; shift ;;
    --version)  VERSION="$2"; shift 2 ;;
    --channel)  CHANNEL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

export OTAKIT_SERVER_URL="$SERVER_URL"

# If no explicit version, bump patch in package.json
if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "
    const pkg = require('./package.json');
    const parts = pkg.version.split('.');
    parts[2] = Number(parts[2]) + 1;
    parts.join('.');
  ")
  # Write bumped version back to package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    pkg.version = '$VERSION';
    fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "Bumped version to $VERSION"
fi

echo "Building OtaKit demo app..."
pnpm build
pnpm exec cap sync ios

if [[ -n "$CHANNEL" ]]; then
  echo "Uploading v$VERSION to $SERVER_URL → channel '$CHANNEL'..."
  pnpm exec otakit upload ./out \
    --version "$VERSION" \
    --channel "$CHANNEL"
else
  echo "Uploading v$VERSION to $SERVER_URL → base channel..."
  pnpm exec otakit upload ./out \
    --version "$VERSION"
fi

echo ""
if [[ -n "$CHANNEL" ]]; then
  echo "Done: OtaKit demo app v$VERSION released to '$CHANNEL' ($SERVER_URL)"
else
  echo "Done: OtaKit demo app v$VERSION released to the base channel ($SERVER_URL)"
fi
