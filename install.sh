#!/usr/bin/env bash
# Downloads, verifies, and installs the anywh relay as a systemd user
# service. Linux and macOS (Apple Silicon) only — on Windows, run this
# inside WSL2.
#
#   curl -fsSL https://anywh.sh/install | sh
#   curl -fsSL https://anywh.sh/install | sh -s -- --version v0.1.1
#
# Installs the latest release unless --version pins one.
# Safe to re-run: it replaces relay/ and
# infra/ under INSTALL_DIR in place, and never touches profile state
# (~/.config/anywh/env/, tracked separately by infra/lib.sh).
set -euo pipefail

REPO="anywh-sh/anywh"
INSTALL_DIR="${ANYWH_INSTALL_DIR:-$HOME/.local/share/anywh}"

err() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: install.sh [--version <tag>]

  --version <tag>   Install that release instead of the latest.
                    Accepts "v0.1.1" or "0.1.1".
EOF
}

# Parsed before anything else so a typo costs nothing: no target detection,
# no prerequisite checks, no network.
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || err "--version needs a value, e.g. --version v0.1.1"
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      err "unknown option: $1"
      ;;
  esac
done

# --- 1. detect target -------------------------------------------------
# Matches the three legs release.yml's build-relay job publishes —
# no darwin-x64 (Intel Mac) and no native Windows.
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)
    case "$arch" in
      x86_64) target="linux-x64" ;;
      aarch64 | arm64) target="linux-arm64" ;;
      *) err "unsupported Linux architecture: $arch" ;;
    esac
    ;;
  Darwin)
    case "$arch" in
      arm64) target="darwin-arm64" ;;
      *) err "anywh relay only ships for Apple Silicon Macs today, not Intel (arch: $arch)" ;;
    esac
    ;;
  *) err "unsupported OS: $os — on Windows, run this inside WSL2" ;;
esac

# --- 2. prerequisites ---------------------------------------------------
# Detected, not installed — same reasoning as the claude CLI check below:
# both are things the user's account/machine needs regardless of anywh,
# not something this script should be trusted to install for them.
command -v node >/dev/null 2>&1 || err "Node.js >=20.12 is required — install it first (https://nodejs.org), then re-run this script"

node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_minor="$(echo "$node_version" | cut -d. -f2)"
if [ "$node_major" -lt 20 ] || { [ "$node_major" -eq 20 ] && [ "$node_minor" -lt 12 ]; }; then
  err "Node.js >=20.12 is required, found $node_version"
fi

if ! command -v claude >/dev/null 2>&1; then
  err "the 'claude' CLI was not found on PATH — install and log in to Claude Code first (https://docs.claude.com/en/docs/claude-code), then re-run this script"
fi

# --- 3. download + verify ------------------------------------------------
# Every release carries the same tarball under two names. The unversioned one
# resolves to the newest release through GitHub's own
# `releases/latest/download` redirect — no API call, no jq dependency on a
# bare box. The versioned one is the only way to address an older release,
# since that redirect only ever points at the newest.
if [ -n "$VERSION" ]; then
  version="${VERSION#v}"
  asset="anywh-relay-${version}-${target}.tar.gz"
  base_url="https://github.com/${REPO}/releases/download/v${version}"
else
  asset="anywh-relay-${target}.tar.gz"
  base_url="https://github.com/${REPO}/releases/latest/download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $asset..."
curl -fsSL "$base_url/$asset" -o "$tmp/$asset" ||
  err "couldn't download $asset — check that the release exists and ships an asset for $target: $base_url"
curl -fsSL "$base_url/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
  err "couldn't download SHA256SUMS from $base_url"

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || err "checksum for $asset not found in SHA256SUMS — the release may still be publishing, try again shortly"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
[ "$expected" = "$actual" ] || err "checksum mismatch for $asset (expected $expected, got $actual)"
echo "Checksum verified."

# --- 4. install -----------------------------------------------------------
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/relay" "$INSTALL_DIR/infra"
tar xzf "$tmp/$asset" -C "$INSTALL_DIR"
echo "Installed to $INSTALL_DIR"

# --- 5. systemd unit --------------------------------------------------
"$INSTALL_DIR/infra/systemd/install.sh" --apply

cat <<EOF

Next: create your first profile —
  "$INSTALL_DIR/infra/systemd/add-profile.sh" default --relay-host <this-machine's-tailscale-or-lan-ip>

See https://github.com/${REPO}/blob/main/infra/systemd/README.md for what
--relay-host should be and how multi-profile setups work.
EOF
