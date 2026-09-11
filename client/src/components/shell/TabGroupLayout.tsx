import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { TabGroupStrip, groupEndDropId } from "@/components/shell/TabGroupStrip";
import { useGroupSizeDrag } from "@/hooks/useGroupSizeDrag";
import { MAX_GROUPS, type Tab, type TabGroup } from "@/hooks/useTabs";
import { profileColorClass } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const HANDLE_PX = 4;
export const EDGE_START_DROP_ID = "group-edge-start";
export const EDGE_END_DROP_ID = "group-edge-end";

export type TabDropTarget =
  | { type: "split-start" }
  | { type: "split-end" }
  | { type: "move"; groupId: string; index: number };

/** Pure resolution of a drag's `over.id` into what should happen on drop —
 * pulled out of `onDragEnd` so it's testable without simulating a real
 * dnd-kit pointer gesture (happy-dom has no layout engine for dnd-kit's own
 * collision detection to work with anyway). `null` means "no-op" — dropped
 * on itself, or on something no longer valid (over is a snapshot of drag
 * start's registered droppables, which could in principle include stale ids
 * a moment after `groups` changes underneath). */
export function resolveTabDrop(tabId: string, overId: string, groups: TabGroup[]): TabDropTarget | null {
  if (overId === tabId) return null;
  if (overId === EDGE_START_DROP_ID) return { type: "split-start" };
  if (overId === EDGE_END_DROP_ID) return { type: "split-end" };

  const endMatch = groups.find((group) => groupEndDropId(group.id) === overId);
  if (endMatch) return { type: "move", groupId: endMatch.id, index: endMatch.tabIds.length };

  // Otherwise `over` is another tab — reorder/move relative to it, same
  // splice-based semantics as the single-group case (arrayMove: the index
  // is read against the pre-drop array, applied after the dragged item is
  // already removed from it).
  const targetGroup = groups.find((group) => group.tabIds.includes(overId));
  if (!targetGroup) return null;
  return { type: "move", groupId: targetGroup.id, index: targetGroup.tabIds.indexOf(overId) };
}

interface TabGroupLayoutProps {
  tabs: Tab[];
  groups: TabGroup[];
  /** The focused group's own active tab — the one visible tab in flat mode
   * below (see `splitEnabled`). */
  activeTabId: string | null;
  /** Below the compact breakpoint (or on iOS, though iOS never reaches this
   * component at all — see `App.tsx`), there's nowhere to put a second
   * column: renders one flat strip over every group's tabs concatenated
   * (`groups.flatMap`) and one full-width panel instead of the side-by-side
   * layout, without touching `groups` itself — the real split stays intact
   * underneath and comes back the moment the viewport widens again. */
  splitEnabled: boolean;
  onSelect: (tabId: string) => void;
  onFocusGroup: (groupId: string) => void;
  onClose: (tabId: string) => void;
  onMoveTab: (tabId: string, groupId: string, index: number) => void;
  onSplitTabToNewGroup: (tabId: string, afterGroupId: string | null) => void;
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

/** Covers roughly the left/right half of the content area (not a thin sliver
 * at the very edge) — painting the actual area a new group would occupy,
 * not just a narrow target to hit, so it reads as "drop here to fill this
 * space" the way an editor's own split-preview does. Only rendered while a
 * drag is in flight and there's room for one more group (`MAX_GROUPS`), so
 * there's never a live drop target promising a split that
 * `onSplitTabToNewGroup` would then silently refuse. A faint tint marks the
 * zone as droppable throughout the drag; it brightens on actual hover. */
function EdgeDropZone({ id, side }: { id: string; side: "left" | "right" }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute inset-y-0 z-20 w-2/5 transition-colors",
        side === "left" ? "left-0" : "right-0",
        isOver ? "bg-accent/25" : "bg-accent/8",
      )}
    />
  );
}

/** Floats with the pointer for the whole drag (`DragOverlay`) — without it,
 * the dragged tab's own translate-transform (from `useSortable`) is still
 * clipped the moment it crosses its strip's `overflow-x-auto` boundary, so
 * dragging toward the content area to split looked like nothing was
 * happening at all. Deliberately simpler than the real tab (no drag handle,
 * no buttons) — it's a preview, not an interactive element. */
function DragPreview({ tab }: { tab: Tab }) {
  return (
    <div className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-bg-sidebar px-3 py-1.5 font-mono text-xs text-foreground shadow-lg">
      <span className={cn("size-1.5 shrink-0 rounded-full", profileColorClass(tab.profileId))} />
      <span className="truncate">{tab.title ?? "Nova sessão"}</span>
    </div>
  );
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
 *
 * Owns the single `DndContext` covering every group's strip — dragging a tab
 * only ever resolves its target (a specific tab to reorder next to, a
 * group's trailing drop zone, or an edge zone to split into a new group) in
 * `onDragEnd`, never in `onDragOver`: moving anything mid-drag would collapse
 * the source group and jump the layout out from under the pointer the moment
 * it emptied out.
 */
export function TabGroupLayout({
  tabs,
  groups,
  activeTabId,
  splitEnabled,
  onSelect,
  onFocusGroup,
  onClose,
  onMoveTab,
  onSplitTabToNewGroup,
  onCommitSizes,
  onRenameSession,
  onDelete,
  renderPanel,
}: TabGroupLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizes = groups.map((group) => group.size);
  const { draggingIndex, startDrag } = useGroupSizeDrag(sizes, containerRef, onCommitSizes);
  const [isDraggingTab, setIsDraggingTab] = useState(false);
  const [activeDragTab, setActiveDragTab] = useState<Tab | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const groupIndexByTabId = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const tabId of group.tabIds) map.set(tabId, index);
    });
    return map;
  }, [groups]);

  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const avail = availExpr(groups.length);

  function handleDragStart(event: DragStartEvent): void {
    setIsDraggingTab(true);
    setActiveDragTab(tabById.get(String(event.active.id)) ?? null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setIsDraggingTab(false);
    setActiveDragTab(null);
    const { active, over } = event;
    if (!over) return;
    const tabId = String(active.id);
    const target = resolveTabDrop(tabId, String(over.id), groups);
    if (!target) return;

    if (target.type === "split-start") {
      onSplitTabToNewGroup(tabId, null);
    } else if (target.type === "split-end") {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup) onSplitTabToNewGroup(tabId, lastGroup.id);
    } else {
      onMoveTab(tabId, target.groupId, target.index);
    }
  }

  // Flat fallback — same-strip reordering (via the DndContext/onDragEnd
  // above) stays available and resolves against the real `groups`, same as
  // the split-capable layout; only the *visual* side-by-side split and its
  // three creation entry points (edge drag, context-menu item, `Ctrl+\`) are
  // unavailable here, never rendering the edge zones or the resize handles.
  if (!splitEnabled) {
    const flatTabIds = groups.flatMap((group) => group.tabIds);
    const lastGroupId = groups[groups.length - 1]?.id ?? "";
    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setIsDraggingTab(false);
          setActiveDragTab(null);
        }}
      >
        <div className="flex h-full min-w-0 flex-col">
          <TabGroupStrip
            groupId={lastGroupId}
            tabs={flatTabIds.map((id) => tabById.get(id)).filter((tab): tab is Tab => tab !== undefined)}
            activeTabId={activeTabId}
            allowSplit={false}
            onSelect={onSelect}
            onClose={onClose}
            onRenameSession={onRenameSession}
            onDelete={onDelete}
            onSplitToNewGroup={() => {}}
          />
          <div className="relative min-h-0 flex-1">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                data-testid={`tab-panel-${tab.id}`}
                className={cn("absolute inset-0 overflow-hidden", tab.id !== activeTabId && "invisible")}
                style={{ contain: "layout paint" }}
              >
                {renderPanel(tab)}
              </div>
            ))}
          </div>
        </div>
        <DragOverlay>{activeDragTab && <DragPreview tab={activeDragTab} />}</DragOverlay>
      </DndContext>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setIsDraggingTab(false);
        setActiveDragTab(null);
      }}
    >
      <div ref={containerRef} className="flex h-full min-w-0 flex-col" style={groupCssVars(groups)}>
        <div className="flex h-9 w-full shrink-0">
          {groups.map((group, index) => (
            <Fragment key={group.id}>
              {index > 0 && (
                <div
                  data-testid={`group-resize-handle-${index - 1}`}
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
                  groupId={group.id}
                  tabs={group.tabIds.map((id) => tabById.get(id)).filter((tab): tab is Tab => tab !== undefined)}
                  activeTabId={group.activeTabId}
                  allowSplit
                  onSelect={onSelect}
                  onClose={onClose}
                  onRenameSession={onRenameSession}
                  onDelete={onDelete}
                  onSplitToNewGroup={(tabId) => onSplitTabToNewGroup(tabId, group.id)}
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
          {isDraggingTab && groups.length < MAX_GROUPS && (
            <>
              <EdgeDropZone id={EDGE_START_DROP_ID} side="left" />
              <EdgeDropZone id={EDGE_END_DROP_ID} side="right" />
            </>
          )}
        </div>
      </div>
      <DragOverlay>{activeDragTab && <DragPreview tab={activeDragTab} />}</DragOverlay>
    </DndContext>
  );
}
