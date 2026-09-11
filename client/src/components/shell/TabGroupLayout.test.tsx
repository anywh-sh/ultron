import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabGroupLayout } from "./TabGroupLayout";
import type { Tab, TabGroup } from "@/hooks/useTabs";

afterEach(() => cleanup());

// happy-dom has no layout engine (`offsetWidth`/`getBoundingClientRect` are
// stubbed in `tests/setup.ts`), so pixel geometry can never be asserted here
// — what actually encodes the design is the `calc()` string itself, over the
// `--g{i}-frac`/`--g{i}-cum` custom properties. These tests pin that formula
// down so a future edit that quietly breaks the strip/panel alignment (or
// reintroduces per-frame React renders during a resize) fails loudly.

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    profileId: "default",
    title: id,
    hasUnreadCompletion: false,
    isRunning: false,
    hasBackgroundJob: false,
    isNew: false,
    ...overrides,
  };
}

function group(id: string, tabIds: string[], size: number): TabGroup {
  return { id, tabIds, activeTabId: tabIds[0] ?? null, size };
}

function renderLayout(tabs: Tab[], groups: TabGroup[]) {
  return render(
    <TooltipProvider>
      <TabGroupLayout
        tabs={tabs}
        groups={groups}
        onSelect={vi.fn()}
        onFocusGroup={vi.fn()}
        onClose={vi.fn()}
        onMoveTab={vi.fn()}
        onCommitSizes={vi.fn()}
        onRenameSession={vi.fn()}
        onDelete={vi.fn()}
        renderPanel={(t) => <div>{t.title}</div>}
      />
    </TooltipProvider>,
  );
}

describe("TabGroupLayout geometry", () => {
  it("fills 100% for a single group", () => {
    const tabs = [tab("s1")];
    renderLayout(tabs, [group("g1", ["s1"], 1)]);

    const panel = screen.getByTestId("tab-panel-s1");
    expect(panel.style.left).toBe("calc(100% * var(--g0-cum, 0) + 0px)");
    expect(panel.style.width).toBe("calc(100% * var(--g0-frac, 1))");
  });

  it("splits the available width (minus handles) proportionally across two groups", () => {
    const tabs = [tab("s1"), tab("s2")];
    renderLayout(tabs, [group("g1", ["s1"], 0.3), group("g2", ["s2"], 0.7)]);

    const panelA = screen.getByTestId("tab-panel-s1");
    const panelB = screen.getByTestId("tab-panel-s2");
    const avail = "calc(100% - 4px)";

    expect(panelA.style.left).toBe(`calc(${avail} * var(--g0-cum, 0) + 0px)`);
    expect(panelA.style.width).toBe(`calc(${avail} * var(--g0-frac, 0.3))`);
    expect(panelB.style.left).toBe(`calc(${avail} * var(--g1-cum, 0) + 4px)`);
    expect(panelB.style.width).toBe(`calc(${avail} * var(--g1-frac, 0.7))`);
  });

  it("accounts for both handles across three groups", () => {
    const tabs = [tab("s1"), tab("s2"), tab("s3")];
    renderLayout(tabs, [group("g1", ["s1"], 0.2), group("g2", ["s2"], 0.3), group("g3", ["s3"], 0.5)]);

    const avail = "calc(100% - 8px)";
    expect(screen.getByTestId("tab-panel-s1").style.left).toBe(`calc(${avail} * var(--g0-cum, 0) + 0px)`);
    expect(screen.getByTestId("tab-panel-s2").style.left).toBe(`calc(${avail} * var(--g1-cum, 0) + 4px)`);
    expect(screen.getByTestId("tab-panel-s3").style.left).toBe(`calc(${avail} * var(--g2-cum, 0) + 8px)`);
  });

  it("gives the strip row the exact same calc() expression as its group's panel, in flexBasis", () => {
    const tabs = [tab("s1"), tab("s2")];
    const groups = [group("g1", ["s1"], 0.4), group("g2", ["s2"], 0.6)];
    renderLayout(tabs, groups);

    for (const [index, g] of groups.entries()) {
      const strip = screen.getByTestId(`group-strip-${g.id}`);
      const panel = screen.getByTestId(`tab-panel-${g.tabIds[0]}`);
      expect(strip.style.flexBasis).toContain(`var(--g${index}-frac`);
      expect(panel.style.width).toContain(`var(--g${index}-frac`);
      // Same avail expression on both, not just the same variable name.
      const availFromStrip = strip.style.flexBasis.split(" * ")[0];
      const availFromPanel = panel.style.width.split(" * ")[0];
      expect(availFromStrip).toBe(availFromPanel);
    }
  });

  it("hides every tab except its group's active one, without ever unmounting it", () => {
    const tabs = [tab("s1"), tab("s2")];
    renderLayout(tabs, [group("g1", ["s1", "s2"], 1)]);

    expect(screen.getByTestId("tab-panel-s1")).not.toHaveClass("invisible");
    const hiddenPanel = screen.getByTestId("tab-panel-s2");
    expect(hiddenPanel).toHaveClass("invisible");
    // Still in the DOM, not removed — that's the whole point of the flat layer.
    expect(hiddenPanel).toBeInTheDocument();
  });
});
