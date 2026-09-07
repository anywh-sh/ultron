# Running the relay as a systemd service

This is the "advanced" self-host path — a persistent service that survives
reboots and restarts on crash. It's optional: `npm start` from an
interactive shell (see the root README) works fine for a single machine you
keep an eye on yourself. Reach for this when you want the relay to come
back on its own after a reboot or a crash, with no one watching.

## One template, any number of profiles

`ultron-relay@.service.template` is a systemd
[instantiated unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#Specifiers) —
one file serves every profile you run (`pessoal`, `trabalho`, `default`,
whatever you call them), each as its own systemd instance
(`ultron-relay@<profile>`). It isn't committed with real paths in it: `User`,
the relay's absolute directory, and the absolute `node` binary path are all
specific to the machine it runs on, so `install.sh` fills those in and
writes the rendered `ultron-relay@.service` next to the template (gitignored
— it's a build artifact, regenerate it whenever paths change).

Profile-specific config (`RELAY_PORT`, `RELAY_HOME_OVERRIDE`, ...) doesn't
live in the unit at all — it comes from two `EnvironmentFile`s, loaded in
order so the second wins on conflicts:

1. `relay/.env` — shared across every profile (`CLAUDE_BIN`,
   `EXTRA_PATH_DIRS`, anything that doesn't vary by profile).
2. `~/.config/ultron/env/<profile>.env` — per-profile overrides.

Both are optional (`EnvironmentFile=-...`), so a single-profile setup can
skip the second file, or even both, and run on the relay's own defaults.

## Setup

```bash
./install.sh                          # renders ultron-relay@.service for this machine
sudo cp ultron-relay@.service /etc/systemd/system/
sudo systemctl daemon-reload

cd ../../relay
npm install && npm run build
cp .env.example .env                  # edit CLAUDE_BIN/EXTRA_PATH_DIRS etc. if needed

sudo systemctl enable --now ultron-relay@default
```

For more than one profile, give each its own env file before enabling it:

```bash
mkdir -p ~/.config/ultron/env
cat > ~/.config/ultron/env/pessoal.env <<'EOF'
RELAY_PORT=8765
RELAY_SESSIONS_FILE=/home/you/.ultron-sessions/pessoal.json
RELAY_BACKGROUND_JOBS_FILE=/home/you/.ultron-sessions/pessoal-bg-jobs.json
RELAY_UPLOAD_DIR=/tmp/ultron-uploads-pessoal
EOF
sudo systemctl enable --now ultron-relay@pessoal
```

Repeat with a second file (different port, paths, and — if it's a fully
separate Claude Code login — `RELAY_HOME_OVERRIDE`) for a second profile.

## Checking it

```bash
systemctl status ultron-relay@default
journalctl -u ultron-relay@default -f
```

## Remote access

The systemd service binds wherever `RELAY_HOST` says (defaults to
`127.0.0.1`, i.e. clients on the same machine only). For access from another
device, see "Remote access" in the root README.
