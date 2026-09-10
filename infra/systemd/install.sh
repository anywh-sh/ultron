#!/usr/bin/env bash
# Renders anywh-relay@.service.template with this machine's paths (absolute
# relay/ directory, absolute node binary — none of which belong in a file
# committed to git). Run once per machine, not once per profile: the same
# rendered unit template serves every profile via systemd's instance
# mechanism (`anywh-relay@<profile>`), see infra/systemd/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_DIR="$(cd "$SCRIPT_DIR/../../relay" && pwd)"
TEMPLATE="$SCRIPT_DIR/anywh-relay@.service.template"
OUTPUT="$SCRIPT_DIR/anywh-relay@.service"

source "$SCRIPT_DIR/../lib.sh"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

sed \
  -e "s|{{WORKING_DIRECTORY}}|$RELAY_DIR|g" \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{ENV_DIR}}|$ANYWH_ENV_DIR|g" \
  "$TEMPLATE" > "$OUTPUT"

cat <<EOF
Rendered: $OUTPUT

Install it once per machine (user-scope unit — no sudo):
  mkdir -p "$HOME/.config/systemd/user"
  cp "$OUTPUT" "$HOME/.config/systemd/user/anywh-relay@.service"
  systemctl --user daemon-reload

  # Needed once per machine so the unit keeps running without an active
  # login session — the default for a user-scope unit on a headless box is
  # to stop the moment the last session for that user ends.
  loginctl enable-linger "$(whoami)"

Then, per profile (e.g. "default", or "pessoal"/"trabalho" for more than
one), point it at a built relay and enable the instance:
  cd "$RELAY_DIR" && npm install && npm run build
  cp .env.example .env   # edit as needed — see infra/systemd/README.md
  systemctl --user enable --now anywh-relay@default
EOF
