import { Fragment, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { TabGroupStrip } from "@/components/shell/TabGroupStrip";
import { useGroupSizeDrag } from "@/hooks/useGroupSizeDrag";
import type { Tab, TabGroup } from "@/hooks/useTabs";
import { cn } from "@/lib/utils";

const HANDLE_PX = 4;

interface TabGroupLayoutProps {
  tabs: Tab[];
  groups: TabGroup[];
  onSelect: (tabId: string) => void;
  onFocusGroup: (groupId: string) => void;
  onClose: (tabId: string) => void;
  onMoveTab: (tabId: string, groupId: string, index: number) => void;
  onCommitSizes: (sizes: number[]) => void;
  onRenameSession: (tabId: string, title: string) => void;
  onDelete: (tabId: string) => void;
  renderPanel: (tab: Tab) => ReactNode;
}

/** One `--g{i}-frac`/`--g{i}-cum` pair per group, set on the outer container
 * so both the strip row and the panel layer below inherit the same values
 * through normal CSS cascade — only one place ever needs to hold them. */
function groupCssVars(groups: TabGroup[]): CSSProperties {
  const vars: Record<string, string> = {};
  let cumulative = 0;
  groups.forEach((group, index) => {
    vars[`--g${index}-frac`] = String(group.size);
    vars[`--g${index}-cum`] = String(cumulative);
    cumulative += group.size;
  });
  return vars as CSSProperties;
}

function availExpr(total: number): string {
  return total > 1 ? `calc(100% - ${(total - 1) * HANDLE_PX}px)` : "100%";
}

/**
 * Replaces `TabBar` in `App.tsx` — renders every group's strip side by side
 * on top, and every tab's panel in one flat, absolutely-positioned layer
 * below (see the "camada plana" design note: keeping every panel a direct,
 * stable-`key` sibling here, regardless of which group currently owns it, is
 * what lets a tab move between groups without React ever unmounting its
 * `ChatPanel` — remount would mean a dropped WebSocket and a skeleton flash).
 *
 * The strip row and the panel layer share the exact same `calc()` expression
 * (over the `--g{i}-frac`/`--g{i}-cum` custom properties from `groupCssVars`)
 * for their geometry, so they stay pixel-aligned by construction — no
 * measuring, no one-frame lag while dragging a resize handle.
 */
export function TabGroupLayout({
  tabs,
  groups,
  onSelect,
  onFocusGroup,
  onClose,
  onMoveTab,
  onCommitSizes,
  onRenameSession,
  onDelete,
  renderPanel,
}: TabGroupLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizes = groups.map((group) => group.size);
  const { draggingIndex, startDrag } = useGroupSizeDrag(sizes, containerRef, onCommitSizes);

  const groupIndexByTabId = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const tabId of group.tabIds) map.set(tabId, index);
    });
    return map;
  }, [groups]);

  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const avail = availExpr(groups.length);

  return (
    <div ref={containerRef} className="flex h-full min-w-0 flex-col" style={groupCssVars(groups)}>
      <div className="flex h-9 w-full shrink-0">
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && (
              <div
                onPointerDown={startDrag(index - 1)}
                className={cn("z-10 w-1 shrink-0 cursor-col-resize hover:bg-border", draggingIndex === index - 1 && "bg-border")}
              />
            )}
            <div
              data-testid={`group-strip-${group.id}`}
              className="min-w-0 shrink-0 grow-0 overflow-hidden"
              style={{
                flexBasis: `calc(${avail} * var(--g${index}-frac, ${group.size}))`,
                transition: draggingIndex === null ? "flex-basis 150ms ease" : "none",
              }}
              // Foreground for "focus follows the pointer": clicking anywhere
              // in a group's strip (not just its tabs) should re-focus that
              // group — capture phase so it fires even when the click's
              // actual target (e.g. a tab button) also has its own handler.
              onPointerDownCapture={() => onFocusGroup(group.id)}
            >
              <TabGroupStrip
                tabs={group.tabIds.map((id) => tabById.get(id)).filter((tab): tab is Tab => tab !== undefined)}
                activeTabId={group.activeTabId}
                onSelect={onSelect}
                onClose={onClose}
                onReorder={(tabId, overTabId) => {
                  const index2 = group.tabIds.indexOf(overTabId);
                  if (index2 !== -1) onMoveTab(tabId, group.id, index2);
                }}
                onRenameSession={onRenameSession}
                onDelete={onDelete}
              />
            </div>
          </Fragment>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const groupIndex = groupIndexByTabId.get(tab.id);
          if (groupIndex === undefined) return null;
          const group = groups[groupIndex];
          const isVisible = group.activeTabId === tab.id;
          return (
            <div
              key={tab.id}
              data-testid={`tab-panel-${tab.id}`}
              // `invisible`, never `display:none`/zero size — a hidden tab's
              // panel keeps its group's box (a virtualized `MessageLog`'s
              // `ResizeObserver` would corrupt its height cache the instant
              // it measures 0, even for a single frame).
              className={cn("absolute inset-y-0 overflow-hidden", !isVisible && "invisible")}
              style={{
                left: `calc(${avail} * var(--g${groupIndex}-cum, 0) + ${groupIndex * HANDLE_PX}px)`,
                width: `calc(${avail} * var(--g${groupIndex}-frac, ${group.size}))`,
                // Scopes layout/paint invalidation to this one panel — a
                // resize of a sibling group must never force this one to
                // re-layout too. Not `strict`/`size`: that would contain
                // this box's own size against its content, which is exactly
                // what would corrupt the virtualizer's measurement above.
                contain: "layout paint",
              }}
              onPointerDownCapture={() => onFocusGroup(group.id)}
            >
              {renderPanel(tab)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
