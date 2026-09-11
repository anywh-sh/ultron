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

import { DangerZone, findSameHostExecutor } from "./SettingsDialog";

function directProfile(id: string, host: string): Profile {
  return { id, label: id, host, relayPort: 8765 };
}

function tailnetProfile(id: string): Profile {
  return {
    id,
    label: id,
    // Every tailnet profile reports this same placeholder host — never a
    // real, shared machine (see ThemeSection's registry comment).
    host: "127.0.0.1",
    relayPort: 0,
    tailnetAuthKey: "key",
    tailnetControlUrl: "https://headscale.test",
    tailnetTarget: "100.64.0.1:8443",
  };
}

describe("findSameHostExecutor", () => {
  it("finds another profile on the same real host as a valid executor (direct mode, unchanged)", () => {
    const scoped = directProfile("a", "192.168.0.10");
    const other = directProfile("b", "192.168.0.10");
    expect(findSameHostExecutor(scoped, [scoped, other])).toBe(other);
  });

  it("never treats another tailnet profile as an executor — each is its own isolated sandbox", () => {
    const scoped = tailnetProfile("sandbox-a");
    const other = tailnetProfile("sandbox-b");
    expect(findSameHostExecutor(scoped, [scoped, other])).toBeUndefined();
  });

  it("never treats a tailnet profile as an executor for a direct profile just because they share the placeholder host", () => {
    const scoped = directProfile("direct", "127.0.0.1");
    const sandbox = tailnetProfile("sandbox-a");
    expect(findSameHostExecutor(scoped, [scoped, sandbox])).toBeUndefined();
  });
});

describe("DangerZone", () => {
  afterEach(() => {
    cleanup();
    removeProfileMock.mockReset().mockReturnValue(true);
  });

  it("offers a local-only removal for a tailnet profile, never the disabled server-delete button", async () => {
    const scoped = tailnetProfile("sandbox-a");
    render(<DangerZone scopedProfile={scoped} allProfiles={[scoped]} onProfileRemoved={() => {}} />);

    // Not the "Excluir do servidor" flow's disabled button — a tailnet
    // profile has no host to call, so it gets its own always-enabled
    // "Remover" action instead of a permanently disabled "Excluir".
    const removeButton = screen.getByRole("button", { name: "Remover" });
    expect(removeButton).toBeEnabled();

    const user = userEvent.setup();
    await user.click(removeButton);
    const confirmButton = await within(document.body).findByRole("button", { name: "Remover" });
    await user.click(confirmButton);

    expect(removeProfileMock).toHaveBeenCalledWith("sandbox-a");
  });

  it("keeps the server-delete flow, disabled with no executor, for a direct profile", () => {
    const scoped = directProfile("solo", "192.168.0.10");
    render(<DangerZone scopedProfile={scoped} allProfiles={[scoped]} onProfileRemoved={() => {}} />);

    expect(screen.getByRole("button", { name: "Excluir" })).toBeDisabled();
  });

  it("reports an error instead of removing the sole remaining tailnet profile", async () => {
    removeProfileMock.mockReturnValue(false);
    const scoped = tailnetProfile("only-one");
    render(<DangerZone scopedProfile={scoped} allProfiles={[scoped]} onProfileRemoved={() => {}} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remover" }));
    const confirmButton = await within(document.body).findByRole("button", { name: "Remover" });
    await user.click(confirmButton);

    expect(await screen.findByText(/único perfil/)).toBeInTheDocument();
  });
});
