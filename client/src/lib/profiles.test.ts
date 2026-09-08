import { beforeEach, describe, expect, it } from "vitest";
import { getProfiles, setProfiles, syncProfilesForHost, type Profile } from "./profiles";
import type { RemoteProfile } from "@/lib/relay-types";

function remote(overrides: Partial<RemoteProfile> & Pick<RemoteProfile, "id" | "host">): RemoteProfile {
  return {
    label: overrides.id,
    colorIndex: 0,
    port: 8765,
    hasHomeOverride: false,
    running: true,
    ...overrides,
  };
}

// Real code path throughout — setProfiles/syncProfilesForHost are the
// production functions (profiles.ts), not stand-ins. Each test seeds a known
// starting list via setProfiles so it doesn't depend on whatever the
// previous test left behind.
beforeEach(() => {
  localStorage.clear();
});

describe("syncProfilesForHost", () => {
  it("regression: a loopback-registered ghost is dropped once a sync against a real host succeeds, even if the ghost's id isn't in that host's response", () => {
    // Reproduces the bug fixed 2026-09-07 (commit 2eff9a7): a stray
    // `npm run dev` self-registers as "default" on 127.0.0.1
    // (relay/src/profileRegistry.ts ensureSelfRegistered) and used to survive
    // forever because the old dedup only matched by host.
    const ghost: Profile = { id: "default", label: "Default", host: "127.0.0.1", relayPort: 8765 };
    setProfiles([ghost]);

    syncProfilesForHost("100.64.0.1", [remote({ id: "pessoal", host: "100.64.0.1" })]);

    const ids = getProfiles().map((p) => p.id);
    expect(ids).toEqual(["pessoal"]);
  });

  it("dedups by id, not host: a stale local entry for an id also present in the remote response is replaced, not duplicated", () => {
    const staleLocal: Profile = { id: "trabalho", label: "Default", host: "127.0.0.1", relayPort: 8765 };
    setProfiles([staleLocal]);

    syncProfilesForHost("100.64.0.2", [remote({ id: "trabalho", host: "100.64.0.2", label: "Trabalho" })]);

    const trabalho = getProfiles().filter((p) => p.id === "trabalho");
    expect(trabalho).toHaveLength(1);
    expect(trabalho[0].host).toBe("100.64.0.2");
    expect(trabalho[0].label).toBe("Trabalho");
  });

  it("keeps profiles known from a different (non-loopback) host untouched", () => {
    const other: Profile = { id: "trabalho", label: "Trabalho", host: "100.64.0.2", relayPort: 8765 };
    setProfiles([other]);

    syncProfilesForHost("100.64.0.1", [remote({ id: "pessoal", host: "100.64.0.1" })]);

    const ids = getProfiles().map((p) => p.id).sort();
    expect(ids).toEqual(["pessoal", "trabalho"]);
  });

  it("never empties the list: an empty remote response for a host that would remove the last known profile is a no-op", () => {
    const only: Profile = { id: "pessoal", label: "Pessoal", host: "100.64.0.1", relayPort: 8765 };
    setProfiles([only]);

    syncProfilesForHost("100.64.0.1", []);

    expect(getProfiles()).toEqual([only]);
  });

  it("regression: a sync that reports the same data back is a no-op on the array/object identity, not just the values", () => {
    // useForegroundSync (client/src/hooks/useForegroundSync.ts) reruns this
    // every 30s and on window focus. Before this fix, every successful sync
    // replaced the array and every Profile object with fresh identities even
    // when nothing changed, so anything keyed on `profile` (e.g. FileViewer's
    // fetch effect, client/src/components/files/FileViewer.tsx) re-ran and
    // flashed its loading state, dropping scroll position, on every poll.
    const existing: Profile = { id: "pessoal", label: "Pessoal", host: "100.64.0.1", relayPort: 8765, colorIndex: 2 };
    setProfiles([existing]);
    const listBefore = getProfiles();
    const profileBefore = listBefore[0];

    syncProfilesForHost("100.64.0.1", [remote({ id: "pessoal", host: "100.64.0.1", label: "Pessoal", colorIndex: 2, port: 8765 })]);

    expect(getProfiles()).toBe(listBefore);
    expect(getProfiles()[0]).toBe(profileBefore);
  });
});
