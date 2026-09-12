import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TurnIndicator } from "./TurnIndicator";
import { en } from "@/i18n/en";

afterEach(() => cleanup());

describe("TurnIndicator", () => {
  it("labels the turn with one of the dictionary's verbs", () => {
    render(<TurnIndicator startedAt={Date.now()} toolCount={0} />);

    const label = screen.getByRole("status").textContent ?? "";
    expect(en.chat.turn.workingWords.some((word) => label.includes(word))).toBe(true);
  });

  it("says what the wait is made of once tools have run", () => {
    render(<TurnIndicator startedAt={Date.now()} toolCount={3} />);

    expect(screen.getByRole("status")).toHaveTextContent(en.chat.turn.toolsUsed.replace("{count}", "3"));
  });

  it("counts one tool in the singular", () => {
    render(<TurnIndicator startedAt={Date.now()} toolCount={1} />);

    expect(screen.getByRole("status")).toHaveTextContent(en.chat.turn.oneToolUsed);
  });

  // The bar stays mounted while idle to hold its row open, so the log's
  // height never changes when a turn starts or ends. Nothing may render
  // inside it, though: `visibility: hidden` does not stop a CSS animation,
  // and the sweep and the spinner would keep running between turns.
  it("renders nothing inside itself while idle", () => {
    render(<TurnIndicator startedAt={null} toolCount={0} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
