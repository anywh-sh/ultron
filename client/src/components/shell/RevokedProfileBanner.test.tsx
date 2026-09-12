import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

const { removeProfileMock } = vi.hoisted(() => ({
  removeProfileMock: vi.fn(() => true),
}));
vi.mock("@/lib/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profiles")>();
  return { ...actual, removeProfile: removeProfileMock };
});

import { RevokedProfileBanner, RevokedProfileBanners } from "@/components/shell/RevokedProfileBanner";
import { clearProfileRevoked, markProfileRevoked } from "@/lib/profileRevocation";
import { setProfiles } from "@/lib/profiles";

const profile: Profile = { id: "p1", label: "Sandbox", host: "127.0.0.1", relayPort: 8765 };
const otherProfile: Profile = { id: "p2", label: "Trabalho", host: "127.0.0.1", relayPort: 8766 };

afterEach(() => {
  cleanup();
  clearProfileRevoked(profile.id);
  clearProfileRevoked(otherProfile.id);
  removeProfileMock.mockClear();
  localStorage.clear();
});

describe("RevokedProfileBanner", () => {
  it("renders nothing when the profile hasn't been revoked", () => {
    render(<RevokedProfileBanner profile={profile} />);
    expect(screen.queryByText(/desconectado da conta/)).not.toBeInTheDocument();
  });

  it("shows the banner once the profile is marked revoked", () => {
    markProfileRevoked(profile.id);
    render(<RevokedProfileBanner profile={profile} />);
    expect(screen.getByText(/desconectado da conta/)).toBeInTheDocument();
  });

  it("removes the profile and hides the banner after confirming", async () => {
    markProfileRevoked(profile.id);
    render(<RevokedProfileBanner profile={profile} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remover perfil" }));
    const confirmButton = await within(document.body).findByRole("button", { name: "Remover" });
    await user.click(confirmButton);

    expect(removeProfileMock).toHaveBeenCalledWith("p1");
    expect(screen.queryByText(/desconectado da conta/)).not.toBeInTheDocument();
  });

  it("dismisses the banner without removing the profile via the close button", async () => {
    markProfileRevoked(profile.id);
    render(<RevokedProfileBanner profile={profile} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Dispensar aviso" }));

    expect(removeProfileMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/desconectado da conta/)).not.toBeInTheDocument();
  });

  it("keeps the banner and shows an error if this is the only profile left", async () => {
    removeProfileMock.mockReturnValue(false);
    markProfileRevoked(profile.id);
    render(<RevokedProfileBanner profile={profile} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remover perfil" }));
    const confirmButton = await within(document.body).findByRole("button", { name: "Remover" });
    await user.click(confirmButton);

    expect(await within(document.body).findByText(/único perfil/)).toBeInTheDocument();
    // The banner itself is still mounted (background content behind an open
    // AlertDialog gets `aria-hidden`, so `getByRole` won't see it — a plain
    // text query still does).
    expect(screen.getByText("Remover perfil")).toBeInTheDocument();
  });
});

describe("RevokedProfileBanners", () => {
  it("shows a banner for a revoked profile even when a different one is active/selected", () => {
    // A background chat tab can detect a non-active profile's
    // revocation (TabGroupLayout's flat panel layer keeps its RelayClient alive) — the
    // notification can't be gated on `activeProfile` for that to reach the
    // user without them switching back on their own.
    setProfiles([profile, otherProfile]);
    markProfileRevoked(otherProfile.id);

    render(<RevokedProfileBanners />);

    expect(screen.getByText(otherProfile.label, { exact: false })).toBeInTheDocument();
  });

  it("renders nothing when no profile is revoked", () => {
    setProfiles([profile, otherProfile]);

    render(<RevokedProfileBanners />);

    expect(screen.queryByText(/desconectado da conta/)).not.toBeInTheDocument();
  });

  it("stacks one banner per revoked profile", () => {
    setProfiles([profile, otherProfile]);
    markProfileRevoked(profile.id);
    markProfileRevoked(otherProfile.id);

    render(<RevokedProfileBanners />);

    expect(screen.getAllByText(/desconectado da conta/)).toHaveLength(2);
  });
});
