import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Tab } from "@/hooks/useProfileTabs";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  renderPanel: (tab: Tab) => ReactNode;
}

/**
 * `forceMount` + `data-[state=inactive]:hidden` em vez de render condicional:
 * é isso que mantém a conexão WS de abas em background viva (docs/18).
 */
export function TabBar({ tabs, activeTabId, onSelect, onClose, renderPanel }: TabBarProps) {
  return (
    <Tabs value={activeTabId ?? undefined} onValueChange={onSelect} className="h-full gap-0">
      <TabsList
        variant="line"
        className="h-auto w-full justify-start gap-0 rounded-none border-b border-border-soft bg-transparent p-0"
      >
        {tabs.map((tab) => (
          <div key={tab.id} className="group relative flex items-center">
            <TabsTrigger
              value={tab.id}
              className="gap-1.5 rounded-none py-2 pr-7 pl-3 font-mono text-xs data-[state=active]:bg-bg-elevated"
            >
              {tab.hasUnreadCompletion && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              <span className="max-w-[120px] truncate">{tab.sessionName}</span>
            </TabsTrigger>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              aria-label={`Fechar aba ${tab.sessionName}`}
              className={cn(
                "absolute right-1.5 cursor-pointer rounded p-0.5 opacity-0 transition-opacity",
                "hover:bg-border group-hover:opacity-100",
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} forceMount className="mt-0 h-[calc(100%-2.25rem)] data-[state=inactive]:hidden">
          {renderPanel(tab)}
        </TabsContent>
      ))}
    </Tabs>
  );
}
