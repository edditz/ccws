#!/usr/bin/env bash
#
# ccws installer — downloads the right single-file binary from GitHub Releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/ccws/main/scripts/install.sh | sh -s -- --repo <owner>/ccws
#   CCWS_REPO=<owner>/ccws curl -fsSL .../install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --repo <owner>/ccws --version v0.1.0 --bin /usr/local/bin
#
# Options:
#   --repo <owner/repo>   GitHub repo hosting releases (or CCWS_REPO env)
#   --bin <dir>           install directory (default ~/.local/bin; or CCWS_INSTALL_DIR)
#   --version <tag>       release tag (default: latest; or CCWS_VERSION)
#   -h, --help            show this help
#
set -euo pipefail

REPO="${CCWS_REPO:-}"
BIN_DIR="${CCWS_INSTALL_DIR:-}"
VERSION="${CCWS_VERSION:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)        REPO="${2:-}"; shift 2 ;;
    --bin)         BIN_DIR="${2:-}"; shift 2 ;;
    --version)     VERSION="${2:-}"; shift 2 ;;
    -h|--help)     sed -n '3,17p' "$0" 2>/dev/null || cat "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$REPO" ]; then
  echo "error: --repo <owner/repo> (or CCWS_REPO env) is required" >&2
  echo "  curl -fsSL .../install.sh | sh -s -- --repo <owner>/ccws" >&2
  exit 1
fi

# ---- detect platform ----
os_raw="$(uname -s)"
arch_raw="$(uname -m)"
case "$os_raw" in
  Darwin)              plat_os=darwin ;;
  Linux)               plat_os=linux ;;
  MINGW*|MSYS*|CYGWIN*) plat_os=windows ;;
  *) echo "error: unsupported OS: $os_raw" >&2; exit 1 ;;
esac
case "$arch_raw" in
  arm64|aarch64) plat_arch=arm64 ;;
  x86_64|amd64)  plat_arch=x64 ;;
  *) echo "error: unsupported arch: $arch_raw (only x64/arm64 binaries are published)" >&2; exit 1 ;;
esac

asset="ccws-${plat_os}-${plat_arch}"
[ "$plat_os" = "windows" ] && asset="${asset}.exe"

# ---- resolve version (default: latest release tag) ----
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  if [ -z "$VERSION" ]; then
    echo "error: could not resolve latest release for ${REPO}" >&2
    exit 1
  fi
fi

# ---- install dir ----
[ -z "$BIN_DIR" ] && BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
dst="${BIN_DIR}/ccws"
[ "$plat_os" = "windows" ] && dst="${BIN_DIR}/ccws.exe"

echo "→ downloading ${asset} (${VERSION}) from ${REPO}"
curl -fsSL "$url" -o "$dst"
chmod +x "$dst" 2>/dev/null || true

# ---- checksum verify (best-effort; silent skip if unavailable) ----
if command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; then
  expected="$(curl -fsSL "https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt" 2>/dev/null \
    | awk -v a="$asset" '$2==a{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$dst" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "$dst" | awk '{print $1}')"
    fi
    [ "$actual" = "$expected" ] || { echo "error: checksum mismatch for $asset" >&2; rm -f "$dst"; exit 1; }
    echo "✓ checksum verified"
  fi
fi

echo "✓ installed ccws ${VERSION} → ${dst}"
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "note: ${BIN_DIR} is not on your PATH. Add it:" >&2
     echo "  export \"PATH=${BIN_DIR}:\$PATH\"" >&2 ;;
esac
