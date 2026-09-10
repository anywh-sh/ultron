import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "@/lib/profiles";
import { customThemesForHost, profilesUsingTheme, resolveProfileTheme, setThemesForHost, themeStoreKey } from "@/lib/themes";
import type { Theme } from "@/lib/theme";

const STORAGE_KEY = "anywh:themes";

const theme: Theme = {
  id: "nord-ish",
  name: "Nord-ish",
  appearance: "dark",
  colors: {},
  terminal: {},
} as Theme;

// Two tailnet profiles (journal/62 F4) always share the same placeholder
// `host` (`profileImport.ts` writes "127.0.0.1" for both) — `id` is the only
// field that actually tells them apart.
const tailnetProfileA: Profile = {
  id: "sandbox-a",
  label: "Sandbox A",
  host: "127.0.0.1",
  relayPort: 0,
  tailnetAuthKey: "key-a",
  tailnetControlUrl: "https://headscale.test",
  tailnetTarget: "100.64.0.1:8765",
  themeId: "nord-ish",
};

const tailnetProfileB: Profile = {
  ...tailnetProfileA,
  id: "sandbox-b",
  label: "Sandbox B",
  tailnetAuthKey: "key-b",
  themeId: undefined,
};

const directProfile: Profile = {
  id: "direct",
  label: "Direct",
  host: "192.168.0.10",
  relayPort: 8765,
};

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("themeStoreKey", () => {
  it("is the profile id for a tailnet profile, not the shared placeholder host", () => {
    expect(themeStoreKey(tailnetProfileA)).toBe("sandbox-a");
    expect(themeStoreKey(tailnetProfileB)).toBe("sandbox-b");
  });

  it("is the host itself for a direct profile", () => {
    expect(themeStoreKey(directProfile)).toBe("192.168.0.10");
  });
});

describe("theme storage keyed by themeStoreKey", () => {
  it("does not let two tailnet profiles' custom themes collide", () => {
    setThemesForHost(themeStoreKey(tailnetProfileA), [theme]);
    expect(customThemesForHost(themeStoreKey(tailnetProfileA))).toEqual([theme]);
    expect(customThemesForHost(themeStoreKey(tailnetProfileB))).toEqual([]);
  });

  it("resolves a tailnet profile's own theme, unaffected by another tailnet profile's registry", () => {
    setThemesForHost(themeStoreKey(tailnetProfileA), [theme]);
    expect(resolveProfileTheme(tailnetProfileA)).toEqual({ theme, missing: false });
    // B never synced this theme into its own (id-keyed) slot, so it falls
    // back to the built-in instead of "seeing" A's registry.
    expect(resolveProfileTheme({ ...tailnetProfileB, themeId: "nord-ish" }).missing).toBe(true);
  });

  it("profilesUsingTheme only reports the profile that actually owns the theme by store key", () => {
    const usedBy = profilesUsingTheme([tailnetProfileA, tailnetProfileB], tailnetProfileA, "nord-ish");
    expect(usedBy).toEqual([tailnetProfileA]);
  });
});
