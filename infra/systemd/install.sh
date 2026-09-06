#!/usr/bin/env bash
# Renders ultron-relay@.service.template with this machine's paths (user,
# absolute relay/ directory, absolute node binary — none of which belong in
# a file committed to git). Run once per machine, not once per profile: the
# same rendered unit template serves every profile via systemd's instance
# mechanism (`ultron-relay@<profile>`), see infra/systemd/README.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_DIR="$(cd "$SCRIPT_DIR/../../relay" && pwd)"
TEMPLATE="$SCRIPT_DIR/ultron-relay@.service.template"
OUTPUT="$SCRIPT_DIR/ultron-relay@.service"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

# Resolved here (not left as the systemd specifier %h) because %h expands to
# the *manager's* home (root, for a system-scope unit) rather than the
# service's own User=, regardless of what that directive says.
ENV_DIR="$HOME/.config/ultron/env"

sed \
  -e "s|{{USER}}|$(whoami)|g" \
  -e "s|{{WORKING_DIRECTORY}}|$RELAY_DIR|g" \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{ENV_DIR}}|$ENV_DIR|g" \
  "$TEMPLATE" > "$OUTPUT"

cat <<EOF
Rendered: $OUTPUT

Install it once per machine:
  sudo cp "$OUTPUT" /etc/systemd/system/ultron-relay@.service
  sudo systemctl daemon-reload

Then, per profile (e.g. "default", or "pessoal"/"trabalho" for more than
one), point it at a built relay and enable the instance:
  cd "$RELAY_DIR" && npm install && npm run build
  cp .env.example .env   # edit as needed — see infra/systemd/README.md
  sudo systemctl enable --now ultron-relay@default
EOF
