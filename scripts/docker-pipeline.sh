#!/usr/bin/env bash
# Runs the GitHub workflow steps locally in Docker Desktop, without publishing anything.
#   1. lint.yml:    npm ci, build, lint, test on each Node version in NODE_VERSIONS
#   2. release.yml: npm ci and build the plugin (Node 24), then collects the release files
# It works on a copy of the repo (.cache/pipeline), so the host's node_modules are never touched.
# Output: dist/release/ (main.js, manifest.json, styles.css, SHA256SUMS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSIONS="${NODE_VERSIONS:-22 24}"
WORK="$ROOT/.cache/pipeline/src"

docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and try again." >&2; exit 1; }

echo "== Copying the repo to $WORK"
rm -rf "$ROOT/.cache/pipeline" && mkdir -p "$WORK"
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .cache "$ROOT"/ "$WORK"/

for v in $NODE_VERSIONS; do
  echo "== lint.yml on Node $v"
  docker run --rm -v "$WORK:/app" -w /app "node:$v" bash -c 'npm ci && npm run build --if-present && npm run lint && npm test'
done

echo "== release.yml on Node 24"
docker run --rm -v "$WORK:/app" -w /app node:24 bash -c 'npm ci && npm run build'

echo "== Collecting release files"
REL="$ROOT/dist/release"
rm -rf "$REL" && mkdir -p "$REL"
cp "$WORK/dist/plugin/main.js" "$WORK/manifest.json" "$WORK/styles.css" "$REL/"
(cd "$REL" && shasum -a 256 main.js manifest.json styles.css > SHA256SUMS)
ls -la "$REL"
echo "== Pipeline finished"
