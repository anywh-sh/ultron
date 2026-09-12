import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setProfiles } from "@/lib/profiles";
import { installFakeRelay, type FakeRelay } from "./helpers/fakeRelay";
import { renderApp } from "./helpers/renderApp";
import { en } from "@/i18n/en";

/**
 * Drives the real `App` through a manual profile switch (via the desktop
 * `ProfileSwitcher`) to prove the sidebar shows the skeleton — never the
 * previous profile's sessions, not even for one frame — while the new
 * profile's session list is still loading. Same tier/reasoning as
 * connectToken.test.tsx: the fake relay's WS layer plus a custom fetch
 * router are the only mocked edge.
 */
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

let relay: FakeRelay;
let resolveProfileBSessions: (() => void) | undefined;

function fakeJsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  localStorage.clear();
  relay = installFakeRelay();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("1.2.3.4:8001/sessions")) {
        return fakeJsonResponse({ sessions: [{ id: "s-a", title: "Conversa da A" }] });
      }
      if (url.includes("5.6.7.8:8002/sessions")) {
        // Held open deliberately — this is the exact window the fix
        // targets: B's fetch hasn't resolved yet, so this render must show
        // neither an empty list nor A's stale one.
        await new Promise<void>((resolve) => {
          resolveProfileBSessions = resolve;
        });
        return fakeJsonResponse({ sessions: [{ id: "s-b", title: "Conversa da B" }] });
      }
      return fakeJsonResponse({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  relay.uninstall();
  resolveProfileBSessions = undefined;
});

describe("session list states across a profile switch", () => {
  it("shows the skeleton, never the previous profile's sessions, while the new one is still loading", async () => {
    setProfiles([
      { id: "a", label: "Profile A", host: "1.2.3.4", relayPort: 8001 },
      { id: "b", label: "Profile B", host: "5.6.7.8", relayPort: 8002 },
    ]);
    const user = userEvent.setup();
    renderApp();

    await screen.findByText("Conversa da A");

    await user.click(await screen.findByRole("button", { name: en.shell.profiles.activeProfile }));
    await user.click(await screen.findByRole("menuitem", { name: /Profile B/ }));

    expect(screen.queryByText("Conversa da A")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Carregando sessões…" })).toBeInTheDocument();

    resolveProfileBSessions?.();
    await screen.findByText("Conversa da B");
  });
});
