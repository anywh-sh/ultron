import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

// Real integration test (.anywh/skills/tests/SKILL.md): the network-crossing
// half of "switching a theme" — saving/listing/deleting a custom theme
// (`/control/themes`, real filesystem via themeRegistry.ts) and assigning one
// to a profile (`/control/profiles/:id`'s `themeId`, profileRegistry.ts).
// Nothing here needs the `claude` process at all.

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function httpUrl(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

const VALID_THEME = {
  version: 1,
  id: "midnight-test",
  name: "Midnight Test",
  appearance: "dark",
  colors: {
    background: "#0a0a0a",
    foreground: "#ffffff",
    "muted-foreground": "#a0a0a0",
    primary: "#3b82f6",
    destructive: "#ef4444",
    border: "#262626",
  },
};

test("saving, assigning, listing and deleting a custom theme reflects across the real registry files, and a deleted theme leaves the profile's reference dangling on purpose", async () => {
  const putResponse = await fetch(httpUrl(`/control/themes/${VALID_THEME.id}`), {
    method: "PUT",
    body: JSON.stringify(VALID_THEME),
  });
  assert.equal(putResponse.status, 200);
  const saved = (await putResponse.json()) as { id: string; updatedAt?: string };
  assert.equal(saved.id, VALID_THEME.id);
  assert.ok(saved.updatedAt, "the relay should stamp updatedAt itself, never trust the author's");

  const invalidTheme = { ...VALID_THEME, id: "broken-test", colors: { background: "#0a0a0a" } };
  const putInvalidResponse = await fetch(httpUrl(`/control/themes/${invalidTheme.id}`), {
    method: "PUT",
    body: JSON.stringify(invalidTheme),
  });
  assert.equal(putInvalidResponse.status, 422);
  const invalidBody = (await putInvalidResponse.json()) as { errors: { path: string }[] };
  assert.ok(
    invalidBody.errors.some((error) => error.path === "colors"),
    "a theme missing required color keys should report which ones, not just fail generically",
  );

  const listed = (await (await fetch(httpUrl("/control/themes"))).json()) as { themes: { id: string }[] };
  assert.ok(listed.themes.some((theme) => theme.id === VALID_THEME.id));
  assert.ok(!listed.themes.some((theme) => theme.id === "broken-test"), "an invalid theme must never reach disk");

  // Assigns the saved theme to the self-registered "default" profile
  // (ensureSelfRegistered, profileRegistry.ts) — this PATCH is the actual
  // "switch to this theme" action a profile-scoped settings UI performs.
  const patchResponse = await fetch(httpUrl("/control/profiles/default"), {
    method: "PATCH",
    body: JSON.stringify({ themeId: VALID_THEME.id }),
  });
  assert.equal(patchResponse.status, 200);

  const profilesAfterAssign = (await (await fetch(httpUrl("/control/profiles"))).json()) as {
    profiles: { id: string; themeId?: string }[];
  };
  assert.equal(profilesAfterAssign.profiles.find((profile) => profile.id === "default")?.themeId, VALID_THEME.id);

  const deleteResponse = await fetch(httpUrl(`/control/themes/${VALID_THEME.id}`), { method: "DELETE" });
  assert.equal(deleteResponse.status, 200);

  const listedAfterDelete = (await (await fetch(httpUrl("/control/themes"))).json()) as { themes: { id: string }[] };
  assert.ok(!listedAfterDelete.themes.some((theme) => theme.id === VALID_THEME.id));

  // themeRegistry.ts's `deleteTheme` deliberately never touches profiles
  // still pointing at the deleted theme — re-adding it later restores the
  // selection, and the client already falls back to the built-in theme when
  // the referenced one is missing. A profile switching flow that silently
  // cleared this on delete would lose the user's choice for good instead.
  const profilesAfterDelete = (await (await fetch(httpUrl("/control/profiles"))).json()) as {
    profiles: { id: string; themeId?: string }[];
  };
  assert.equal(profilesAfterDelete.profiles.find((profile) => profile.id === "default")?.themeId, VALID_THEME.id);

  const secondDeleteResponse = await fetch(httpUrl(`/control/themes/${VALID_THEME.id}`), { method: "DELETE" });
  assert.equal(secondDeleteResponse.status, 404);
});
