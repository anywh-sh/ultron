import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile } from "@/lib/profiles";
import type { Theme } from "@/lib/theme";

vi.mock("@/lib/relayClient", () => ({
  fetchThemes: vi.fn(),
  updateProfileMeta: vi.fn(),
  deleteTheme: vi.fn(),
  saveTheme: vi.fn(),
  ThemeSaveError: class ThemeSaveError extends Error {},
}));
vi.mock("@/lib/connectionResolver", () => ({
  resolveConnection: vi.fn(),
  authHeaders: () => ({}),
}));

import { fetchThemes, updateProfileMeta, deleteTheme } from "@/lib/relayClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { ThemeSection } from "./ThemeSection";

const CUSTOM_THEME: Theme = {
  version: 1,
  id: "custom-b",
  name: "Custom B",
  appearance: "dark",
  colors: {
    background: "#000000",
    foreground: "#ffffff",
    "muted-foreground": "#888888",
    primary: "#ff0000",
    destructive: "#ff0000",
    border: "#333333",
  },
};

function tailnetProfile(id: string, label: string): Profile {
  return {
    id,
    label,
    // Every tailnet profile reports this same placeholder — the real
    // address only exists after `resolveConnection` resolves the sidecar
    // (see connectionResolver.ts).
    host: "127.0.0.1",
    relayPort: 0,
    tailnetAuthKey: "key",
    tailnetControlUrl: "https://headscale.test",
    tailnetTarget: "100.64.0.1:8443",
  };
}

// Two different tailnet profiles, each its own sandbox — distinct resolved
// connections prove which one a call actually went to.
const activeProfile = tailnetProfile("sandbox-a", "A");
const scopedProfile = tailnetProfile("sandbox-b", "B");

const CONNECTIONS: Record<string, { host: string; port: number; token: string }> = {
  "sandbox-a": { host: "127.0.0.1", port: 11111, token: "token-a" },
  "sandbox-b": { host: "127.0.0.1", port: 22222, token: "token-b" },
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchThemes).mockResolvedValue([CUSTOM_THEME]);
  vi.mocked(updateProfileMeta).mockResolvedValue({
    id: "sandbox-b",
    label: "B",
    colorIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  vi.mocked(deleteTheme).mockResolvedValue(undefined);
  vi.mocked(resolveConnection).mockImplementation((profile: Profile) =>
    Promise.resolve(CONNECTIONS[profile.id]),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThemeSection with two distinct tailnet profiles", () => {
  it("selects a theme through the scoped profile's own sidecar, not the active profile's", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSection scopedProfile={scopedProfile} activeProfile={activeProfile} allProfiles={[activeProfile, scopedProfile]} />,
    );

    await user.click(await screen.findByText("Custom B"));

    await vi.waitFor(() => expect(updateProfileMeta).toHaveBeenCalled());
    expect(updateProfileMeta).toHaveBeenCalledWith(
      "127.0.0.1",
      22222,
      "sandbox-b",
      { themeId: "custom-b" },
      "token-b",
    );
  });

  it("deletes a theme through the scoped profile's own sidecar, not the active profile's", async () => {
    const user = userEvent.setup();
    render(
      <ThemeSection scopedProfile={scopedProfile} activeProfile={activeProfile} allProfiles={[activeProfile, scopedProfile]} />,
    );

    await screen.findByText("Custom B");
    await user.click(screen.getByRole("button", { name: "Excluir Custom B" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await vi.waitFor(() => expect(deleteTheme).toHaveBeenCalled());
    expect(deleteTheme).toHaveBeenCalledWith("127.0.0.1", 22222, "custom-b", "token-b");
  });
});
