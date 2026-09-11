import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";
import type { SetupState } from "@/lib/profileSetup";
import { ProfileSetupDialog } from "./ProfileSetupDialog";

const profile: Profile = {
  id: "new-profile",
  label: "New machine",
  host: "127.0.0.1",
  relayPort: 0,
  brokerNodeId: "node-1",
  brokerUrl: "https://broker.test/w1",
  tailnetAuthKey: "key",
  tailnetControlUrl: "https://ctrl.test",
};

const existingProfile: Profile = { id: "existing", label: "Existing machine", host: "1.2.3.4", relayPort: 8443 };

function noop() {}

afterEach(() => {
  cleanup();
});

describe("ProfileSetupDialog", () => {
  it("renders nothing when there is no state", () => {
    render(
      <ProfileSetupDialog state={null} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the tailnet claim step as running while claiming", () => {
    const state: SetupState = { status: "claiming", mode: "tailnet" };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );
    expect(screen.getByText("Conectando à nova máquina")).toBeInTheDocument();
    expect(screen.getByText("Resgatando código")).toBeInTheDocument();
    // Not yet failed or done — no action button beyond the always-present dismiss.
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar para novo perfil" })).not.toBeInTheDocument();
  });

  it("shows the direct-mode step list with just one row", () => {
    const state: SetupState = { status: "connecting", mode: "direct", profile: { ...profile, id: "direct-profile" } };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );
    expect(screen.getByText("Verificando")).toBeInTheDocument();
    expect(screen.queryByText("Resgatando código")).not.toBeInTheDocument();
    expect(screen.queryByText("Conectando")).not.toBeInTheDocument();
  });

  it("on ready, shows the session count and a working Continuar button", async () => {
    const onContinue = vi.fn();
    const state: SetupState = { status: "ready", mode: "tailnet", profile, info: { sessionCount: 3 }, duplicates: [] };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={onContinue} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );

    expect(screen.getByText("Máquina conectada")).toBeInTheDocument();
    expect(screen.getByText(/3 conversa/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Continuar para novo perfil" }));
    expect(onContinue).toHaveBeenCalledWith(profile.id);
  });

  it("on ready with a duplicate, offers to go to the existing profile", async () => {
    const onUseExisting = vi.fn();
    const state: SetupState = {
      status: "ready",
      mode: "tailnet",
      profile,
      info: { sessionCount: 0 },
      duplicates: [existingProfile],
    };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={onUseExisting} onRetry={noop} onDismiss={noop} />,
    );

    expect(screen.getByText(existingProfile.label, { exact: false })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ir para o perfil existente" }));
    expect(onUseExisting).toHaveBeenCalledWith(existingProfile.id);
  });

  it("on a terminal claim failure, offers only dismiss — nothing to retry", () => {
    const state: SetupState = { status: "failed", mode: "tailnet", stage: "claim" };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );

    expect(screen.getByText("Não foi possível parear")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deixar para depois" })).toBeInTheDocument();
  });

  it("on a recoverable connect failure, retrying calls onRetry", async () => {
    const onRetry = vi.fn();
    const state: SetupState = { status: "failed", mode: "tailnet", stage: "connect", profile };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={onRetry} onDismiss={noop} />,
    );

    expect(screen.getByText("Falha ao conectar")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the dedicated button", async () => {
    const onDismiss = vi.fn();
    const state: SetupState = { status: "claiming", mode: "direct" };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={onDismiss} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Deixar para depois" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape — blocking but closeable", async () => {
    const onDismiss = vi.fn();
    const state: SetupState = { status: "claiming", mode: "direct" };
    render(
      <ProfileSetupDialog state={state} queuedCount={0} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={onDismiss} />,
    );

    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the queued count in the footer", () => {
    const state: SetupState = { status: "claiming", mode: "tailnet" };
    render(
      <ProfileSetupDialog state={state} queuedCount={2} onContinue={noop} onUseExisting={noop} onRetry={noop} onDismiss={noop} />,
    );
    expect(screen.getByText("+2 na fila")).toBeInTheDocument();
  });
});
