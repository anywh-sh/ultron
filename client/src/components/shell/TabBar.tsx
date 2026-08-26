import type { ReactNode } from "react";
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
import type { Tab } from "@/hooks/useProfileTabs";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  profileId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onReorder: (activeTabId: string, overTabId: string) => void;
  onDelete: (tabId: string) => void;
  renderPanel: (tab: Tab) => ReactNode;
}

interface SortableTabProps {
  tab: Tab;
  profileId: string;
  onClose: (tabId: string) => void;
  onDelete: (tabId: string) => void;
}

/**
 * Só espalha `listeners`/`setNodeRef` do dnd-kit, não `attributes` — evita
 * `role`/`tabIndex` genéricos colidindo com o `role="tab"` que o Radix já
 * expõe corretamente no `TabsTrigger` (RovingFocusGroup, WAI-ARIA Tabs).
 * Sem `KeyboardSensor` no `DndContext` pelo mesmo motivo: ArrowLeft/Right já
 * move o foco entre abas via Radix, colidiria com "mover item arrastado".
 */
function SortableTab({ tab, profileId, onClose, onDelete }: SortableTabProps) {
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
            profileId === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
            tab.isRunning && "animate-pulse",
          )}
          aria-label={tab.isRunning ? "Agente trabalhando nesta sessão" : undefined}
        />
        {tab.hasUnreadCompletion && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
        <span className="max-w-[120px] truncate">{tab.title ?? "Nova conversa"}</span>
      </TabsTrigger>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
        aria-label={`Fechar aba ${tab.title ?? "nova conversa"}`}
        className={cn(
          "absolute right-1.5 cursor-pointer rounded p-0.5 opacity-0 transition-opacity",
          "hover:bg-border group-hover:opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
      <SessionDeleteMenu menu={menu} title={tab.title ?? "nova conversa"} onDelete={() => onDelete(tab.id)} />
    </div>
  );
}

/**
 * `forceMount` em vez de render condicional: é isso que mantém a conexão WS
 * de abas em background viva (docs/18). A aba inativa é escondida com
 * `invisible` (`visibility:hidden`), não `hidden`/`display:none` — o
 * `MessageLog` de cada aba usa `@tanstack/react-virtual`, cujo
 * `ResizeObserver` (tanto do container quanto de cada item medido) dispara
 * com tamanho 0 assim que um ancestral vira `display:none`. Isso corrompe o
 * cache de alturas e ainda aciona o ajuste automático de `scrollTop` que o
 * virtualizador faz pra manter o fim colado quando um item muda de tamanho
 * de verdade — resultado: reabrir a aba jogava o scroll pra outro lugar,
 * mesmo que estivesse no fim. `visibility:hidden` não colapsa a caixa (o
 * `ResizeObserver` nunca vê 0), só empilhamos as abas com `absolute inset-0`
 * dentro do wrapper `relative` pra ocuparem o mesmo espaço sem depender do
 * fluxo flex.
 */
export function TabBar({ tabs, activeTabId, profileId, onSelect, onClose, onReorder, onDelete, renderPanel }: TabBarProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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
              <SortableTab key={tab.id} tab={tab} profileId={profileId} onClose={onClose} onDelete={onDelete} />
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
    </Tabs>
  );
}
