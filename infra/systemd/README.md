# Running the relay as a systemd service

This is the "advanced" self-host path — a persistent service that survives
reboots and restarts on crash. It's optional: `npm start` from an
interactive shell (see the root README) works fine for a single machine you
keep an eye on yourself. Reach for this when you want the relay to come
back on its own after a reboot or a crash, with no one watching.

## One template, any number of profiles

`anywh-relay@.service.template` is a systemd
[instantiated unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#Specifiers) —
one file serves every profile you run (`pessoal`, `trabalho`, `default`,
whatever you call them), each as its own systemd instance
(`anywh-relay@<profile>`). It's a user-scope unit (`systemctl --user`, no
sudo) — running as *your* user was always the intent, since the relay only
ever needed to run as whoever owns the Claude Code login it's isolating, not
as root. It isn't committed with real paths in it: the relay's absolute
directory and the absolute `node` binary path are specific to the machine it
runs on, so `install.sh` fills those in and writes the rendered
`anywh-relay@.service` next to the template (gitignored — it's a build
artifact, regenerate it whenever paths change).

Profile-specific config (`RELAY_PORT`, `RELAY_HOME_OVERRIDE`, ...) doesn't
live in the unit at all — it comes from two `EnvironmentFile`s, loaded in
order so the second wins on conflicts:

1. `relay/.env` — shared across every profile (`AGENT_BIN`,
   `EXTRA_PATH_DIRS`, anything that doesn't vary by profile).
2. `~/.config/anywh/env/<profile>.env` — per-profile overrides.

Both are optional (`EnvironmentFile=-...`), so a single-profile setup can
skip the second file, or even both, and run on the relay's own defaults.

## Setup

```bash
./install.sh                          # renders anywh-relay@.service for this machine
mkdir -p ~/.config/systemd/user
cp anywh-relay@.service ~/.config/systemd/user/
systemctl --user daemon-reload

# Once per machine — a user-scope unit stops the moment your last login
# session ends unless linger is on, which defeats the point on a headless
# box with no one logged in most of the time.
loginctl enable-linger "$(whoami)"

cd ../../relay
npm install && npm run build
cp .env.example .env                  # edit AGENT_BIN/EXTRA_PATH_DIRS etc. if needed

systemctl --user enable --now anywh-relay@default
```

For more than one profile, give each its own env file before enabling it:

```bash
mkdir -p ~/.config/anywh/env
cat > ~/.config/anywh/env/pessoal.env <<'EOF'
RELAY_PORT=8765
RELAY_SESSIONS_FILE=/home/you/.anywh-sessions/pessoal.json
RELAY_BACKGROUND_JOBS_FILE=/home/you/.anywh-sessions/pessoal-bg-jobs.json
RELAY_UPLOAD_DIR=/tmp/anywh-uploads-pessoal
ANYWH_EDITOR_LOCAL=1
EOF
systemctl --user enable --now anywh-relay@pessoal
```

Or use `add-profile.sh` (same directory) to generate the `.env` and enable
the instance in one step — see its `--help` output. This is the same script
the client's own **Adicionar perfil** → **Criar** dialog calls behind the
scenes (root README's "Profiles" section) — reach for it directly only when
scripting a setup or working before the app is even connected.

Repeat with a second file (different port, paths, and — if it's a fully
separate Claude Code login — `RELAY_HOME_OVERRIDE`) for a second profile.

## Checking it

```bash
systemctl --user status anywh-relay@default
journalctl --user -u anywh-relay@default -f
```

## Remote access

The systemd service binds wherever `RELAY_HOST` says (defaults to
`127.0.0.1`, i.e. clients on the same machine only). For access from another
device, see "Remote access" in the root README.
