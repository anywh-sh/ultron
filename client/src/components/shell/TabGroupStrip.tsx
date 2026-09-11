import { useRef, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, scrollHorizontallyOnWheel, truncateWords } from "@/lib/utils";
import type { Tab } from "@/hooks/useTabs";
import { profileActiveBgClass } from "@/lib/profiles";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";
import { RenameSessionDialog } from "@/components/shell/RenameSessionDialog";

// A long enough session title (auto-inferred from the first prompt, or
// hand-typed via rename) could otherwise stretch the tooltip arbitrarily
// wide — this caps it to roughly a glance's worth of text, kept on the one
// line TooltipContent below forces with `whitespace-nowrap`.
const MAX_TOOLTIP_TITLE_WORDS = 12;

interface TabGroupStripProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (activeTabId: string, overTabId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
  onDelete: (tabId: string) => void;
}

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tab: Tab) => void;
  onDelete: (tabId: string) => void;
  buttonRef: (id: string, el: HTMLButtonElement | null) => void;
}

// Was Radix's `TabsTrigger` (`components/ui/tabs.tsx`) before a group could
// have more than one strip alive at once — Radix's `Tabs` root only supports
// a single active `value` shared by every descendant, which stopped working
// the moment two groups each needed their own independently-active tab. This
// reproduces its exact resolved classes by hand (the "line" variant,
// horizontal orientation — the only combination this app ever used) and
// keeps setting `data-state`/`aria-selected` itself instead of delegating to
// Radix, so `profileActiveBgClass`'s `data-[state=active]:bg-*` classes (and
// every other `data-[state=active]:` selector already written against this
// markup) keep working completely unmodified.
const TAB_TRIGGER_CLASS =
  "relative z-10 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:text-foreground min-w-0 gap-1.5 rounded-none py-2 pr-7 pl-3 font-mono text-xs";

/**
 * Only spreads dnd-kit's `listeners`/`setNodeRef`, not `attributes` — avoids
 * generic `role`/`tabIndex` colliding with the `role="tab"` the inner button
 * sets itself. No `KeyboardSensor` on the `DndContext` for the same reason:
 * ArrowLeft/Right already moves focus between tabs (roving focus, see
 * `TabGroupStrip`'s `handleTabListKeyDown`), would collide with "move
 * dragged item".
 */
function SortableTab({ tab, isActive, onSelect, onClose, onRename, onDelete, buttonRef }: SortableTabProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab.id });
  const menu = useContextMenu();

  return (
    <Tooltip>
      {/* Wraps the whole row (not just the tab button) for two reasons: (1)
          this plain `div` has no `data-state` of its own, so the tooltip's
          `asChild` prop merge landing on it can't clobber anything — an
          earlier attempt wrapped the tab button directly, which merged the
          tooltip's own open/closed `data-state` on top of the tab's own
          active/inactive one, silently breaking both the profile tint and
          the border override that key off it. (2) unlike a `display:contents`
          wrapper (tried first, to dodge exactly that collision), this `div`
          has a real box — Radix Popper positions the tooltip off the
          trigger's `getBoundingClientRect()`, which is empty for a `contents`
          element, so it anchored at the viewport's top-left instead of under
          the tab. */}
      <TooltipTrigger asChild>
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
          <button
            ref={(el) => buttonRef(tab.id, el)}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-state={isActive ? "active" : "inactive"}
            data-tab-id={tab.id}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            // No more active-tab bar (the "line" look never painted one) —
            // the selected tab is marked by tinting its own background with
            // the session's profile color instead.
            className={cn(TAB_TRIGGER_CLASS, profileActiveBgClass(tab.profileId))}
          >
            {tab.isRunning ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-foreground" aria-label="Agente trabalhando nesta sessão" />
            ) : (
              tab.hasUnreadCompletion && (
                <span className="size-1.5 shrink-0 rounded-full bg-status-done" aria-label="Sessão finalizada" />
              )
            )}
            <span className="min-w-0 flex-1 truncate">{tab.title ?? "Nova sessão"}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            aria-label={`Fechar aba ${tab.title ?? "nova sessão"}`}
            className={cn(
              // `z-20`: the tab button sits at `z-10` and, being `position:
              // relative`, paints above this sibling `button` otherwise —
              // its clickable box covers the full row including the `pr-7`
              // padding reserved for this button, so without a higher
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
      </TooltipTrigger>
      {/* `whitespace-nowrap` overrides TooltipContent's own `text-balance`
          (which wraps to balance line lengths) — with the word cap above,
          there's no need to wrap at all, and wrapping read as a bug here. */}
      <TooltipContent side="bottom" className="whitespace-nowrap">
        {truncateWords(tab.title ?? "Nova sessão", MAX_TOOLTIP_TITLE_WORDS)}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One group's tab strip — extracted out of `TabBar` (now `TabGroupLayout`'s
 * per-group piece) so a multi-group layout can mount one of these per
 * column without duplicating the drag/rename/context-menu wiring. Self-
 * contained: no Radix `Tabs` ancestor needed (each strip owns its own
 * active-tab state via `activeTabId`/`onSelect`), which is exactly what lets
 * more than one of these be mounted at once with independently active tabs.
 */
export function TabGroupStrip({ tabs, activeTabId, onSelect, onClose, onReorder, onRenameSession, onDelete }: TabGroupStripProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over && over.id !== active.id) onReorder(String(active.id), String(over.id));
  }

  // Manual roving focus (ArrowLeft/Right) — replaces the Radix `Tabs` root's
  // own `RovingFocusGroup`, which went away along with it. "Automatic
  // activation" to match its default: moving focus also selects, exactly
  // like Radix's `activationMode="automatic"` did.
  function handleTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target as HTMLElement;
    const currentId = target.dataset.tabId;
    if (!currentId) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex === -1) return;
    const nextIndex = event.key === "ArrowLeft" ? currentIndex - 1 : currentIndex + 1;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    event.preventDefault();
    onSelect(nextTab.id);
    buttonRefs.current.get(nextTab.id)?.focus();
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          <div
            role="tablist"
            aria-orientation="horizontal"
            onWheel={scrollHorizontallyOnWheel}
            onKeyDown={handleTabListKeyDown}
            // `overflow-y-hidden` isn't decorative here: per the CSS overflow
            // spec, `overflow-x: auto` with `overflow-y` left at its default
            // `visible` gets that default computed up to `auto` too — so
            // without this, shrinking the window narrow enough for a tab's
            // content to wrap could pop a vertical scrollbar on a strip
            // that's meant to only ever scroll horizontally.
            className="scrollbar-thin flex h-9 w-full flex-nowrap items-center justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-none border-b border-border-soft bg-transparent p-0 text-muted-foreground"
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onSelect={onSelect}
                onClose={onClose}
                onRename={(renamedTab) => setRenaming({ id: renamedTab.id, title: renamedTab.title ?? "" })}
                onDelete={onDelete}
                buttonRef={(id, el) => {
                  if (el) buttonRefs.current.set(id, el);
                  else buttonRefs.current.delete(id);
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
    </>
  );
}
