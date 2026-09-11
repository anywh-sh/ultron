import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "@/lib/relay-types";
import { SessionList } from "./SessionList";

const sessions: SessionSummary[] = [
  { id: "s1", title: "First session" },
  { id: "s2", title: "Second session" },
];

function noop() {}

afterEach(() => {
  cleanup();
});

describe("SessionList", () => {
  it("shows the skeleton while loading, with no sessions and no empty-state message", () => {
    render(
      <SessionList
        sessions={[]}
        loading
        error={false}
        onRetry={noop}
        selected={null}
        running={new Set()}
        backgroundJobSessions={new Set()}
        onSelect={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("nenhuma sessão ainda")).not.toBeInTheDocument();
  });

  it("shows an error message with a retry button once loading finishes", async () => {
    const onRetry = vi.fn();
    render(
      <SessionList
        sessions={[]}
        loading={false}
        error
        onRetry={onRetry}
        selected={null}
        running={new Set()}
        backgroundJobSessions={new Set()}
        onSelect={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("Não foi possível carregar as conversas.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty-state message only once loaded, with no error, and no sessions", () => {
    render(
      <SessionList
        sessions={[]}
        loading={false}
        error={false}
        onRetry={noop}
        selected={null}
        running={new Set()}
        backgroundJobSessions={new Set()}
        onSelect={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("nenhuma sessão ainda")).toBeInTheDocument();
  });

  it("renders the sessions once loaded, without the empty-state message", () => {
    render(
      <SessionList
        sessions={sessions}
        loading={false}
        error={false}
        onRetry={noop}
        selected="s1"
        running={new Set()}
        backgroundJobSessions={new Set()}
        onSelect={noop}
        onRename={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("First session")).toBeInTheDocument();
    expect(screen.getByText("Second session")).toBeInTheDocument();
    expect(screen.queryByText("nenhuma sessão ainda")).not.toBeInTheDocument();
  });
});
