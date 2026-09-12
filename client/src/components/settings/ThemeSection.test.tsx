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
import { getSelectedThemeId, setSelectedThemeId } from "@/lib/themes";
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
// connections prove which one a call actually went to. Only the connected
// one is a registry this section can write.
const activeProfile = tailnetProfile("sandbox-a", "A");
const otherProfile = tailnetProfile("sandbox-b", "B");

const CONNECTIONS: Record<string, { host: string; port: number; token: string }> = {
  "sandbox-a": { host: "127.0.0.1", port: 11111, token: "token-a" },
  "sandbox-b": { host: "127.0.0.1", port: 22222, token: "token-b" },
};

beforeEach(() => {
  localStorage.clear();
  setSelectedThemeId(null);
  vi.mocked(fetchThemes).mockResolvedValue([CUSTOM_THEME]);
  vi.mocked(deleteTheme).mockResolvedValue(undefined);
  vi.mocked(resolveConnection).mockImplementation((profile: Profile) =>
    Promise.resolve(CONNECTIONS[profile.id]),
  );
});

afterEach(() => {
  cleanup();
  setSelectedThemeId(null);
  vi.restoreAllMocks();
});

describe("ThemeSection", () => {
  it("picking a theme is a device-local choice, with no relay round trip", async () => {
    const user = userEvent.setup();
    render(<ThemeSection activeProfile={activeProfile} />);

    await user.click(await screen.findByText("Custom B"));

    expect(getSelectedThemeId()).toBe("custom-b");
    // The theme used to be a field on the profile, PATCHed onto its host.
    expect(updateProfileMeta).not.toHaveBeenCalled();
  });

  it("deletes a theme through the connected profile's own sidecar", async () => {
    const user = userEvent.setup();
    render(<ThemeSection activeProfile={activeProfile} />);

    await screen.findByText("Custom B");
    await user.click(screen.getByRole("button", { name: "Excluir Custom B" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await vi.waitFor(() => expect(deleteTheme).toHaveBeenCalled());
    expect(deleteTheme).toHaveBeenCalledWith("127.0.0.1", 11111, "custom-b", "token-a");
  });

  it("offers a theme mirrored from another host, without offering to edit a file it can't write", async () => {
    const { setThemesForHost } = await import("@/lib/themes");
    setThemesForHost(otherProfile.id, [{ ...CUSTOM_THEME, id: "from-b", name: "From B" }]);

    render(<ThemeSection activeProfile={activeProfile} />);

    await screen.findByText("From B");
    expect(screen.queryByRole("button", { name: "Excluir From B" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar From B" })).toBeNull();
  });
});
