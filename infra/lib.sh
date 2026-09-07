# Shared by install.sh and add-profile.sh (infra/systemd/) — sourced, not
# executed, so it only ever defines this one variable.
#
# Mirror of ENV_DIR in relay/src/profileRegistry.ts — keep both in sync.
# Duplicated instead of shared across the language boundary because
# systemd's EnvironmentFile can't source a shell variable, and the relay
# needs the value with no shell involved at all.
ULTRON_ENV_DIR="${ULTRON_ENV_DIR:-$HOME/.config/ultron/env}"
