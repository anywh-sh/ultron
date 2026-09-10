#!/usr/bin/env bash
# Provisions a new relay profile (docs/45): writes the profile's `.env`,
# records it in `profiles.json`, and (in --mode prod) enables the systemd
# instance. Counterpart to install.sh, which provisions the shared unit
# template once per machine — this runs once per profile.
#
# `--mode prod`'s `systemctl --user enable --now` only works once the unit
# template is user-scope (docs/45 Fase 4) — running it before that lands
# fails for lack of a user session (no XDG_RUNTIME_DIR/DBus). Use
# `--mode dev` until then.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <id> [options]

  --label <text>       Display label (default: <id>)
  --home <path>        Overridden \$HOME for this profile's claude account
                        (default: the real \$HOME, i.e. no isolation)
  --port <port>        Relay port (default: first free port found)
  --relay-host <ip>    Host this profile's relay binds/advertises on
                        (default: read from an existing profile's .env)
  --mode dev|prod      dev prints the run command; prod enables the
                        systemd instance (default: prod)
EOF
  # $1: exit code — 0 for an explicit --help, 1 for a usage error, so
  # scripting against this doesn't see "help was shown" as a failure.
  exit "${1:-1}"
}

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage "$([[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && echo 0 || echo 1)"
fi
ID="$1"
shift

LABEL=""
PROFILE_HOME=""
PORT=""
RELAY_HOST_ARG=""
MODE="prod"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --home) PROFILE_HOME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --relay-host) RELAY_HOST_ARG="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    *) echo "error: unknown argument '$1'" >&2; usage ;;
  esac
done

if [[ ! "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "error: invalid profile id '$ID' (expected ^[a-z0-9][a-z0-9-]*\$)" >&2
  exit 1
fi
if [[ "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "error: --mode must be 'dev' or 'prod'" >&2
  exit 1
fi

ENV_FILE="$ANYWH_ENV_DIR/$ID.env"
if [[ -e "$ENV_FILE" ]]; then
  echo "error: profile '$ID' already exists ($ENV_FILE)" >&2
  exit 1
fi

LABEL="${LABEL:-$ID}"

# Same host as this machine's other profiles, if any — every profile on one
# machine reaches the outside world the same way. Omitting this defaults
# the relay to loopback (server.ts's own fallback), unreachable from
# another device even though it's running fine — the most confusing failure
# mode in docs/45's "armadilhas confirmadas", because nothing looks wrong
# locally.
RELAY_HOST="$RELAY_HOST_ARG"
if [[ -z "$RELAY_HOST" ]]; then
  RELAY_HOST="$(grep -h '^RELAY_HOST=' "$ANYWH_ENV_DIR"/*.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
if [[ -z "$RELAY_HOST" ]]; then
  echo "error: --relay-host is required (no existing profile to read a default from)" >&2
  exit 1
fi

# Bash's own /dev/tcp, not a bind test: good enough for a script an operator
# runs occasionally, unlike the relay's own `allocatePort`
# (profileRegistry.ts) which also test-binds because it has to be race-safe
# against `POST /control/profiles` calls.
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

allocate_port() {
  local claimed
  claimed="$(grep -h '^RELAY_PORT=' "$ANYWH_ENV_DIR"/*.env 2>/dev/null | cut -d= -f2- || true)"
  local port
  for ((port = 8765; port < 8865; port++)); do
    if grep -qx "$port" <<<"$claimed"; then
      continue
    fi
    if port_in_use "$port"; then
      continue
    fi
    echo "$port"
    return 0
  done
  echo "error: no free relay port in 8765-8865" >&2
  return 1
}

if [[ -z "$PORT" ]]; then
  PORT="$(allocate_port)"
fi

if [[ -n "$PROFILE_HOME" ]]; then
  # Absolute, `~` expanded, and created if new (the account's `claude
  # login` needs a real directory to write credentials into before this
  # profile can ever pass validation) — a relative or `~`-prefixed path in
  # the .env would be interpreted relative to whatever cwd/$HOME the
  # *relay* process happens to have, not this shell's.
  PROFILE_HOME="${PROFILE_HOME/#\~/$HOME}"
  mkdir -p "$PROFILE_HOME"
  PROFILE_HOME="$(cd "$PROFILE_HOME" && pwd)"
fi

mkdir -p "$ANYWH_ENV_DIR"
mkdir -p "$HOME/.ultron-sessions"

{
  echo "RELAY_PORT=$PORT"
  echo "RELAY_HOST=$RELAY_HOST"
  # Omitted entirely for the real $HOME: EnvironmentFile has no way to
  # express "unset a variable", and an empty value would still be truthy in
  # buildChildEnv's `if (homeOverride)` check (claudeSession.ts).
  if [[ -n "$PROFILE_HOME" && "$PROFILE_HOME" != "$HOME" ]]; then
    echo "RELAY_HOME_OVERRIDE=$PROFILE_HOME"
  fi
  echo "RELAY_UPLOAD_DIR=/tmp/ultron-uploads-$ID"
  echo "RELAY_SESSIONS_FILE=$HOME/.ultron-sessions/$ID.json"
  echo "RELAY_BACKGROUND_JOBS_FILE=$HOME/.ultron-sessions/$ID-bg-jobs.json"
  # "Open in editor" (journal/60) on by default for every profile this
  # script provisions — safe because editorHostInfo.ts's peer check only
  # ever downgrades this to ssh/null for a client connecting from a
  # different machine, never promotes it; it can't leak "local" to a
  # remote client. Remove this line (or set it to anything other than "1")
  # to opt out. The paid sandbox never runs this script — its own image
  # build pre-seeds this same variable explicitly empty (journal/60 part 5,
  # journal/51), a completely separate mechanism, so this default has no
  # effect on that path.
  echo "ANYWH_EDITOR_LOCAL=1"
} > "$ENV_FILE"

# `profiles.json` read-modify-write done in Node (already a hard
# requirement for the relay itself) rather than hand-rolled in bash —
# allocates the smallest colorIndex not already taken, same rule as
# `profileColorClass` uses for profiles that predate the field.
PROFILES_JSON="$(dirname "$ANYWH_ENV_DIR")/profiles.json"
node -e '
const fs = require("fs");
// `-e` doesn'\''t consume an argv slot for a script filename the way a real
// script file would, so the first CLI arg is argv[1], not argv[2].
const [, path, id, label] = process.argv;
let data = { version: 1, profiles: [] };
if (fs.existsSync(path)) {
  try {
    data = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    // Falls back to an empty registry — a corrupt profiles.json shouldn'\''t
    // block provisioning a new profile.
  }
}
if (!Array.isArray(data.profiles)) data.profiles = [];

const used = new Set(data.profiles.map((p) => p.colorIndex).filter((i) => typeof i === "number"));
let colorIndex = 0;
while (used.has(colorIndex)) colorIndex++;

const now = new Date().toISOString();
const existing = data.profiles.find((p) => p.id === id);
const entry = {
  id,
  label,
  colorIndex: existing ? existing.colorIndex : colorIndex,
  createdAt: existing ? existing.createdAt : now,
  updatedAt: now,
};
data.profiles = [...data.profiles.filter((p) => p.id !== id), entry];
fs.writeFileSync(path, JSON.stringify(data, null, 2));
' "$PROFILES_JSON" "$ID" "$LABEL"

echo "Provisioned $ENV_FILE"

RELAY_DIR="$(cd "$SCRIPT_DIR/../../relay" && pwd)"

if [[ "$MODE" == "dev" ]]; then
  cat <<EOF

Run it in dev mode with:
  cd "$RELAY_DIR" && ANYWH_PROFILE=$ID npm run dev:profile
EOF
else
  systemctl --user enable --now "ultron-relay@$ID"
  echo "Enabled ultron-relay@$ID (check: systemctl --user status ultron-relay@$ID)"
fi
