import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownContent } from "./MarkdownContent";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

afterEach(cleanup);

describe("MarkdownContent", () => {
  it("renders a path-like inline code span as a clickable button when onOpenPath is given", async () => {
    const onOpenPath = vi.fn();
    render(<MarkdownContent text="Salvei em `screenshots/PROJ-929/foo.png`." onOpenPath={onOpenPath} />);

    const link = screen.getByRole("button", { name: "screenshots/PROJ-929/foo.png" });
    await userEvent.click(link);
    expect(onOpenPath).toHaveBeenCalledWith("screenshots/PROJ-929/foo.png");
  });

  it("leaves a path-like inline code span as plain code when onOpenPath is omitted", () => {
    render(<MarkdownContent text="Salvei em `screenshots/PROJ-929/foo.png`." />);

    expect(screen.queryByRole("button", { name: "screenshots/PROJ-929/foo.png" })).not.toBeInTheDocument();
    expect(screen.getByText("screenshots/PROJ-929/foo.png").tagName).toBe("CODE");
  });

  it("leaves inline code that doesn't look like a path as plain code", () => {
    const onOpenPath = vi.fn();
    render(<MarkdownContent text="Roda com `npm test`." onOpenPath={onOpenPath} />);

    expect(screen.queryByRole("button", { name: "npm test" })).not.toBeInTheDocument();
    expect(screen.getByText("npm test").tagName).toBe("CODE");
  });

  it("doesn't linkify a path-like string inside a fenced code block, even with onOpenPath given", () => {
    const onOpenPath = vi.fn();
    render(<MarkdownContent text={"```\nscreenshots/PROJ-929/foo.png\n```"} onOpenPath={onOpenPath} />);

    expect(screen.queryByRole("button", { name: /foo\.png/ })).not.toBeInTheDocument();
  });
});
