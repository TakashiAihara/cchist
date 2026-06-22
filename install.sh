#!/bin/sh
# cchist installer — downloads the matching prebuilt binary from GitHub Releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/TakashiAihara/cchist/main/install.sh | sh
#
# Env overrides:
#   CCHIST_VERSION       release tag to install (default: latest, e.g. v0.2.0)
#   CCHIST_INSTALL_DIR   directory to install into (default: $HOME/.local/bin)

set -eu

REPO="TakashiAihara/cchist"
VERSION="${CCHIST_VERSION:-latest}"
INSTALL_DIR="${CCHIST_INSTALL_DIR:-${HOME}/.local/bin}"

log()  { printf 'cchist-install: %s\n' "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

# --- preflight -------------------------------------------------------------

command -v curl >/dev/null 2>&1 || die "curl is required but was not found in PATH."
command -v uname >/dev/null 2>&1 || die "uname is required but was not found in PATH."

# --- detect target ---------------------------------------------------------

uname_s=$(uname -s)
case "$uname_s" in
  Linux)  os=linux ;;
  Darwin) os=darwin ;;
  *)      die "unsupported OS: $uname_s (supported: Linux, Darwin)" ;;
esac

uname_m=$(uname -m)
case "$uname_m" in
  x86_64|amd64)   arch=x64 ;;
  arm64|aarch64)  arch=arm64 ;;
  *)              die "unsupported arch: $uname_m (supported: x86_64, arm64/aarch64)" ;;
esac

asset="cchist-${os}-${arch}"

# --- resolve URL -----------------------------------------------------------

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

log "platform: ${os}/${arch}"
log "version:  ${VERSION}"
log "source:   ${url}"
log "target:   ${INSTALL_DIR}/cchist"

# --- download --------------------------------------------------------------

tmpdir=$(mktemp -d 2>/dev/null || mktemp -d -t cchist)
trap 'rm -rf "$tmpdir"' EXIT INT TERM

tmpfile="${tmpdir}/${asset}"
# -f: fail on HTTP errors (4xx/5xx) instead of writing the body to disk.
# -L: follow redirects (releases/latest/download/ is one).
if ! curl -fL --progress-bar -o "$tmpfile" "$url"; then
  die "download failed: ${url}"
fi

# Reject HTML responses (e.g. 404 page) that slipped past -f.
case "$(head -c 16 "$tmpfile" 2>/dev/null || true)" in
  '<!DOCTYPE html'*|'<html'*)
    die "downloaded content looks like HTML, not a binary. URL: ${url}"
    ;;
esac

chmod +x "$tmpfile"

# --- install ---------------------------------------------------------------

mkdir -p "$INSTALL_DIR" || die "cannot create install dir: ${INSTALL_DIR}"
mv -f "$tmpfile" "${INSTALL_DIR}/cchist" || die "cannot write to ${INSTALL_DIR}/cchist"

installed_version=$("${INSTALL_DIR}/cchist" --version 2>/dev/null || echo "(version check failed)")
log "installed cchist ${installed_version} -> ${INSTALL_DIR}/cchist"

# --- PATH advice -----------------------------------------------------------

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    log "ready: '${INSTALL_DIR}' is already on your PATH."
    ;;
  *)
    log "note: '${INSTALL_DIR}' is NOT on your PATH."
    log "      add this to your shell profile (e.g. ~/.zshrc, ~/.bashrc):"
    log "        export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac
