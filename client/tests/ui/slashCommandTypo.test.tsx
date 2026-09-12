import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeRelay, type FakeRelay } from "./helpers/fakeRelay";
import { renderApp } from "./helpers/renderApp";

// Same mocks as sendMessage.test.tsx — see the comment there for why these
// two are unavoidable outside a real Tauri shell.
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));

let relay: FakeRelay;

beforeEach(() => {
  localStorage.clear();
  relay = installFakeRelay("fake relay reply");
});

afterEach(() => {
  cleanup();
  relay.uninstall();
});

/** Types `text` into a fresh conversation's composer and waits for the send
 * button to become enabled — the same two gates (non-empty composer, fake
 * relay's `open`+`caught_up` landed) `sendMessage.test.tsx` waits on, needed
 * here too since Enter's own send path (`Composer`'s `handleKeyDown`) is
 * gated behind that same "connected" flag. Returns the composer without
 * pressing Enter — callers decide how the text is (or isn't) submitted. */
async function typeIntoComposer(user: ReturnType<typeof userEvent.setup>, text: string) {
  renderApp();
  await user.click(await screen.findByRole("button", { name: "Nova conversa" }));
  const composer = await screen.findByLabelText("Escreva uma mensagem…");
  await user.type(composer, text);
  const sendButton = await screen.findByRole("button", { name: "Enviar" });
  await vi.waitFor(() => expect(sendButton).toBeEnabled());
  return composer;
}

describe("typo'd slash command", () => {
  it("blocks the send and offers the fix instead of forwarding it as a chat message", async () => {
    const user = userEvent.setup();
    const composer = await typeIntoComposer(user, "/cler");

    await user.type(composer, "{Enter}");

    expect(await screen.findByText(/quis dizer/i)).toBeInTheDocument();
    expect(screen.getByText("/clear")).toBeInTheDocument();
    // Blocked: the text stays put in the composer (not cleared like a real
    // send would), and never became a chat message — no reply came back.
    expect(composer).toHaveTextContent("/cler");
    expect(screen.queryByText("fake relay reply")).not.toBeInTheDocument();
  });

  it("applies the suggested fix on demand instead of sending right away", async () => {
    const user = userEvent.setup();
    const composer = await typeIntoComposer(user, "/moel opus");

    await user.type(composer, "{Enter}");
    await user.click(await screen.findByRole("button", { name: "Usar" }));

    expect(composer).toHaveTextContent("/model opus");
    // Applying the fix only fills the composer — it's still up to the user
    // to send it, same as picking an entry from the autocomplete menu.
    expect(screen.queryByText(/quis dizer/i)).not.toBeInTheDocument();
    expect(screen.queryByText("fake relay reply")).not.toBeInTheDocument();
  });

  it("sends the original text as-is when the user confirms it wasn't a typo", async () => {
    const user = userEvent.setup();
    const composer = await typeIntoComposer(user, "/cler");

    await user.type(composer, "{Enter}");
    await user.click(await screen.findByRole("button", { name: "Enviar mesmo assim" }));

    expect(await screen.findByText("/cler")).toBeInTheDocument();
    expect(await screen.findByText("fake relay reply")).toBeInTheDocument();
  });
});
