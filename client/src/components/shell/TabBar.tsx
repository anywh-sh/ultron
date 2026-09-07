import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Tab } from "@/hooks/useTabs";
import { profileColorClass } from "@/lib/profiles";
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
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1 : undefined,
      }}
      className="group relative flex items-center"
    >
      <TabsTrigger
        value={tab.id}
        className="gap-1.5 rounded-none py-2 pr-7 pl-3 font-mono text-xs data-[state=active]:bg-bg-elevated"
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            profileColorClass(tab.profileId),
            tab.isRunning && "animate-pulse",
          )}
          aria-label={tab.isRunning ? "Agente trabalhando nesta sessão" : undefined}
        />
        {tab.hasUnreadCompletion && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
        <span className="max-w-[120px] truncate">{tab.title ?? "Nova sessão"}</span>
      </TabsTrigger>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
        aria-label={`Fechar aba ${tab.title ?? "nova sessão"}`}
        className={cn(
          "absolute right-1.5 cursor-pointer rounded p-0.5 opacity-0 transition-opacity",
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
            className="h-auto w-full justify-start gap-0 rounded-none border-b border-border-soft bg-transparent p-0"
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
