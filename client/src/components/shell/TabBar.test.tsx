import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabBar } from "./TabBar";
import type { Tab } from "@/hooks/useTabs";

afterEach(() => cleanup());

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "s1",
    profileId: "default",
    title: "Uma sessão com título comprido o bastante pra ser truncado na aba",
    hasUnreadCompletion: false,
    isRunning: false,
    hasBackgroundJob: false,
    isNew: false,
    ...overrides,
  };
}

function renderTabBar(tabs: Tab[], activeTabId: string | null) {
  return render(
    <TooltipProvider>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onRenameSession={vi.fn()}
        onDelete={vi.fn()}
        renderPanel={() => null}
      />
    </TooltipProvider>,
  );
}

describe("TabBar", () => {
  // Regression: wrapping TabsTrigger in `<TooltipTrigger asChild>` directly
  // used to leak the tooltip's own `data-state` (open/closed) onto it —
  // Radix Tabs' own implementation spreads incoming props *after* setting
  // `data-state` to active/inactive, so the leaked value silently won and
  // the selected tab never carried `data-state="active"` at all. Neither the
  // profile-tinted background nor the border override (both keyed off
  // `data-[state=active]`) could ever match — the tab just showed through to
  // the page's neutral background instead of its profile color.
  it("keeps the selected tab's own data-state=active even though it's wrapped in a tooltip", () => {
    const t = tab();
    renderTabBar([t], t.id);

    const trigger = screen.getByRole("tab", { name: t.title! });
    expect(trigger).toHaveAttribute("data-state", "active");
  });

  it("does not mark an unselected tab as active", () => {
    const active = tab({ id: "s1", title: "Ativa" });
    const other = tab({ id: "s2", title: "Inativa" });
    renderTabBar([active, other], active.id);

    expect(screen.getByRole("tab", { name: "Ativa" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Inativa" })).toHaveAttribute("data-state", "inactive");
  });

  it("shows the tab's full title in a tooltip on hover", async () => {
    const user = userEvent.setup();
    const t = tab();
    renderTabBar([t], t.id);

    await user.hover(screen.getByRole("tab", { name: t.title! }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(t.title!);
  });

  it("truncates a tooltip title past 12 words instead of letting it run arbitrarily long", async () => {
    const user = userEvent.setup();
    const longTitle = "Uma sessão com um título absurdamente comprido que passa longe do limite razoável de doze palavras";
    const t = tab({ title: longTitle });
    renderTabBar([t], t.id);

    await user.hover(screen.getByRole("tab"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      "Uma sessão com um título absurdamente comprido que passa longe do limite...",
    );
    expect(tooltip).not.toHaveTextContent("razoável");
  });
});
