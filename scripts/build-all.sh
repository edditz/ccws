#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist
targets=(
  "bun-darwin-arm64:ccws-darwin-arm64"
  "bun-darwin-x64:ccws-darwin-x64"
  "bun-linux-x64:ccws-linux-x64"
  "bun-linux-arm64:ccws-linux-arm64"
  "bun-windows-x64:ccws-windows-x64.exe"
)
for entry in "${targets[@]}"; do
  target="${entry%%:*}"
  out="dist/${entry##*:}"
  echo "building $out ($target)"
  bun build src/cli.ts --compile --target="$target" --outfile="$out"
done
echo "done: $(ls dist)"
