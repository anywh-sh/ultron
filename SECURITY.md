# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:

➡️ **[Open a private security advisory](https://github.com/anywh-sh/anywh/security/advisories/new)**

That channel is visible only to the maintainers. Include what you'd need if you
were on the other side: affected component (`relay/`, `client/`, `infra/`),
version or commit, steps to reproduce, and what an attacker gets out of it.

Expect an acknowledgement within a few days. This is a small project maintained
by one person, so please don't read silence as dismissal — ping the advisory
thread if a week goes by.

Please give us a reasonable window to ship a fix before disclosing publicly.
Credit in the advisory and the release notes if you want it.

## Supported versions

Only the [latest release](https://github.com/anywh-sh/anywh/releases/latest) is
supported. Fixes ship forward; there are no backports to older tags.

## Threat model — read this before reporting

anywh is **self-hosted software with an explicitly trusted network boundary**.
Several things that look like vulnerabilities are documented, deliberate design
decisions, and reporting them tells us nothing we don't already know:

- **The relay has no authentication and CORS is wide open.** The assumed
  boundary is your LAN or a personal Tailscale/WireGuard network — not the
  public internet.
- **The relay's default permission mode is `bypassPermissions`**
  (`--dangerously-skip-permissions`). Anyone who can reach the port can run
  arbitrary code as you. This is the product working as designed.
- **Exposing the relay port to the internet is out of scope.** The
  [README](./README.md#security-model) tells you not to.

### In scope

Anything that breaks the trusted-network assumption rather than relying on it:

- The relay listening on a broader interface than `RELAY_HOST` configures.
- Escaping the session's working directory through the file browser or the
  editor-open path.
- `ANTHROPIC_API_KEY`, credentials, or session data leaking out of the machine —
  including into a spawned child process that should not have it.
- The pairing flow (`docs/pairing.md`) accepting a profile from somewhere it
  shouldn't, or leaking one.
- Relay-controlled content escaping the client's webview sandbox, or reaching
  the Tauri command surface from rendered conversation content.
- A reachable vulnerability in a dependency we ship.

### Out of scope

- The three design decisions listed above.
- Findings that require the attacker to already have code execution or a shell
  on the relay machine — at that point they have your `claude` session anyway.
- Reports from automated scanners with no demonstrated impact on this codebase.
- Anything about `anywh.sh` the marketing site rather than this repository.
