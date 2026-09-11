import type { ReactNode } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { Tab } from "@/hooks/useTabs";
import { TabGroupStrip } from "@/components/shell/TabGroupStrip";

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
  return (
    <Tabs value={activeTabId ?? undefined} onValueChange={onSelect} className="h-full gap-0">
      <TabGroupStrip tabs={tabs} onClose={onClose} onReorder={onReorder} onRenameSession={onRenameSession} onDelete={onDelete} />

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
    </Tabs>
  );
}
