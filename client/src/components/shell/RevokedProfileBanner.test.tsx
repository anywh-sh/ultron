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

import { RevokedProfileBanner } from "@/components/shell/RevokedProfileBanner";
import { clearProfileRevoked, markProfileRevoked } from "@/lib/profileRevocation";

const profile: Profile = { id: "p1", label: "Sandbox", host: "127.0.0.1", relayPort: 8765 };

afterEach(() => {
  cleanup();
  clearProfileRevoked(profile.id);
  removeProfileMock.mockClear();
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
