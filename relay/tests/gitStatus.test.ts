import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type WebSocket from "ws";
import { startTestServer, type TestServer } from "./helpers/testServer.js";
import { connectSession } from "./helpers/wsClient.js";

// Real integration test (.anywh/skills/tests/SKILL.md): `GET /git/status`
// against a real repository created by the real `git` binary, reached
// through a session whose cwd was set over the real WebSocket. gitStatus.ts's
// unit tests cover the output format; what only this tier can prove is the
// wiring — that the route resolves the cwd from `?session=` rather than
// trusting the client, that the child process actually runs in that
// directory, and that a cwd outside any repository answers 200 with the
// segment turned off instead of failing the request.

let server: TestServer;
let repoDir: string;
let plainDir: string;
const sockets: WebSocket[] = [];

/** Every git call the test makes carries its own identity and template dir:
 * the machine running the tests has a real `~/.gitconfig` (and may have
 * `init.defaultBranch` set to anything), and none of that may decide what
 * this test asserts. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=anywh test", "-c", "user.email=test@anywh.sh", ...args], {
    cwd,
    encoding: "utf8",
  });
}

before(async () => {
  server = await startTestServer();
  repoDir = realpathSync(mkdtempSync(join(tmpdir(), "anywh-git-repo-")));
  plainDir = realpathSync(mkdtempSync(join(tmpdir(), "anywh-git-plain-")));

  git(repoDir, "init", "-b", "redesign/f8-status-bar");
  writeFileSync(join(repoDir, "README.md"), "# fixture\n");
  git(repoDir, "add", "README.md");
  git(repoDir, "commit", "-m", "initial commit");
});

after(async () => {
  for (const socket of sockets) socket.close();
  await server.close();
});

function httpUrl(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

/** Points a real session at `dir` and waits for the relay's own `cwd_state`
 * broadcast before returning — the explicit synchronization the skill asks
 * for, instead of assuming the WS message was processed by the time the
 * next HTTP request fires. */
async function openSessionAt(sessionId: string, dir: string): Promise<void> {
  const socket = await connectSession(server.port, sessionId);
  sockets.push(socket);
  socket.send(JSON.stringify({ type: "set_cwd", path: dir }));
  await new Promise<void>((resolveCwd) => {
    function onMessage(raw: Buffer): void {
      const message = JSON.parse(raw.toString()) as { type: string; cwd?: string };
      if (message.type === "cwd_state" && message.cwd === dir) {
        socket.off("message", onMessage);
        resolveCwd();
      }
    }
    socket.on("message", onMessage);
  });
}

interface GitStatusBody {
  repo: boolean;
  branch?: string;
  detached?: boolean;
  changes?: number;
}

async function fetchStatus(sessionId: string): Promise<GitStatusBody> {
  const response = await fetch(httpUrl(`/git/status?session=${encodeURIComponent(sessionId)}`));
  assert.equal(response.status, 200);
  return (await response.json()) as GitStatusBody;
}

test("GET /git/status reports the branch of the session's own cwd, and follows the tree as it changes", async () => {
  await openSessionAt("session-git", repoDir);

  const clean = await fetchStatus("session-git");
  assert.deepEqual(clean, { repo: true, branch: "redesign/f8-status-bar", detached: false, changes: 0 });

  // An untracked file and a modified tracked one — two entries `git status`
  // would list, so two changes in the bar.
  writeFileSync(join(repoDir, "notes.txt"), "scratch\n");
  writeFileSync(join(repoDir, "README.md"), "# fixture, edited\n");
  const dirty = await fetchStatus("session-git");
  assert.equal(dirty.repo, true);
  assert.equal(dirty.changes, 2);
});

test("GET /git/status resolves the cwd from the session id, not from the caller", async () => {
  // Two sessions, two directories, one relay: the second one must not
  // inherit the first one's repository. This is the claim that matters
  // security-wise — the route never takes a path from the client at all.
  await openSessionAt("session-git-plain", plainDir);

  const outsideRepo = await fetchStatus("session-git-plain");
  assert.deepEqual(outsideRepo, { repo: false });

  const stillTheRepo = await fetchStatus("session-git");
  assert.equal(stillTheRepo.branch, "redesign/f8-status-bar");
});

test("GET /git/status: an unknown session falls back to the relay's default cwd without failing", async () => {
  // The client can ask about a session the relay has never seen (a tab
  // restored from disk before its socket connects). That answers for the
  // default cwd — whatever it is — and must never 404 the status bar.
  const body = await fetchStatus("session-never-opened");
  assert.equal(typeof body.repo, "boolean");
});
