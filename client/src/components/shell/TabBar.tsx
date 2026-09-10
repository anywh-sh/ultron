import { useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Tab } from "@/hooks/useTabs";
import { profileActiveBgClass } from "@/lib/profiles";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";
import { RenameSessionDialog } from "@/components/shell/RenameSessionDialog";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (activeTabId: string, overTabId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
  onDelete: (tabId: string) => void;
  renderPanel: (tab: Tab) => ReactNode;
}

interface SortableTabProps {
  tab: Tab;
  onClose: (tabId: string) => void;
  onRename: (tab: Tab) => void;
  onDelete: (tabId: string) => void;
}

/**
 * Only spreads dnd-kit's `listeners`/`setNodeRef`, not `attributes` — avoids
 * generic `role`/`tabIndex` colliding with the `role="tab"` Radix already
 * correctly exposes on `TabsTrigger` (RovingFocusGroup, WAI-ARIA Tabs). No
 * `KeyboardSensor` on the `DndContext` for the same reason: ArrowLeft/Right
 * already moves focus between tabs via Radix, would collide with "move
 * dragged item".
 */
function SortableTab({ tab, onClose, onRename, onDelete }: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab.id });
  const menu = useContextMenu();

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      onContextMenu={menu.onContextMenu}
      // Chrome-style middle-click-to-close, anywhere on the tab (not just
      // the X). `onMouseDown` (not `onClick`, which never fires for the
      // middle button) prevents the browser's autoscroll-mode cursor —
      // that starts on mousedown, so `onAuxClick` alone would still flash it.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose(tab.id);
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
      className="group relative flex min-w-[72px] flex-[0_1_168px] items-center"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <TabsTrigger
            value={tab.id}
            // No more active-tab bar (ui/tabs.tsx no longer paints one for the
            // "line" variant) — the selected tab is now marked by tinting its
            // own background with the session's profile color instead.
            className={cn(
              "min-w-0 gap-1.5 rounded-none py-2 pr-7 pl-3 font-mono text-xs",
              profileActiveBgClass(tab.profileId),
            )}
          >
            {tab.isRunning ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-foreground" aria-label="Agente trabalhando nesta sessão" />
            ) : (
              tab.hasUnreadCompletion && (
                <span className="size-1.5 shrink-0 rounded-full bg-status-done" aria-label="Sessão finalizada" />
              )
            )}
            <span className="min-w-0 flex-1 truncate">{tab.title ?? "Nova sessão"}</span>
          </TabsTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tab.title ?? "Nova sessão"}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
        aria-label={`Fechar aba ${tab.title ?? "nova sessão"}`}
        className={cn(
          // `z-20`: `TabsTrigger` sits at `z-10` (see `ui/tabs.tsx`) and,
          // being `position: relative`, paints above this sibling `button`
          // otherwise — its clickable box covers the full row including the
          // `pr-7` padding reserved for this button, so without a higher
          // z-index the trigger intercepts every click meant for the X.
          "absolute right-1.5 z-20 cursor-pointer rounded p-0.5 opacity-0 transition-opacity",
          "hover:bg-border group-hover:opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
      <SessionDeleteMenu
        menu={menu}
        title={tab.title ?? "nova sessão"}
        onRename={() => onRename(tab)}
        onDelete={() => onDelete(tab.id)}
      />
    </div>
  );
}

/**
 * `forceMount` instead of conditional rendering: this is what keeps
 * background tabs' WS connection alive (docs/18). The inactive tab is
 * hidden with `invisible` (`visibility:hidden`), not `hidden`/`display:none`
 * — each tab's `MessageLog` uses `@tanstack/react-virtual`, whose
 * `ResizeObserver` (both the container's and each measured item's) fires
 * with size 0 as soon as an ancestor becomes `display:none`. That corrupts
 * the height cache and also triggers the automatic `scrollTop` adjustment
 * the virtualizer does to keep the end pinned when an item really changes
 * size — result: reopening the tab would throw the scroll somewhere else,
 * even if it was at the end. `visibility:hidden` doesn't collapse the box
 * (the `ResizeObserver` never sees 0), we just stack the tabs with
 * `absolute inset-0` inside the `relative` wrapper so they occupy the same
 * space without depending on flex flow.
 */
export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onReorder,
  onRenameSession,
  onDelete,
  renderPanel,
}: TabBarProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over && over.id !== active.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <Tabs value={activeTabId ?? undefined} onValueChange={onSelect} className="h-full gap-0">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          <TabsList
            variant="line"
            className="scrollbar-thin h-auto w-full flex-nowrap justify-start gap-0 overflow-x-auto rounded-none border-b border-border-soft bg-transparent p-0"
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                onClose={onClose}
                onRename={(renamedTab) => setRenaming({ id: renamedTab.id, title: renamedTab.title ?? "" })}
                onDelete={onDelete}
              />
            ))}
          </TabsList>
        </SortableContext>
      </DndContext>

      <div className="relative h-[calc(100%-2.25rem)]">
        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            forceMount
            className="invisible absolute inset-0 mt-0 h-full data-[state=active]:visible"
          >
            {renderPanel(tab)}
          </TabsContent>
        ))}
      </div>

      <RenameSessionDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        initialTitle={renaming?.title ?? ""}
        onSave={(title) => {
          if (renaming) onRenameSession(renaming.id, title);
          setRenaming(null);
        }}
      />
    </Tabs>
  );
}
