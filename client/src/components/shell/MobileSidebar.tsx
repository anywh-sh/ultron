import { useState } from "react";
import { Search } from "lucide-react";
import { SessionList } from "@/components/shell/SessionList";
import { RenameSessionDialog } from "@/components/shell/RenameSessionDialog";
import { cn } from "@/lib/utils";
import { PROFILES, type Profile } from "@/lib/profiles";
import type { SessionSummary } from "@/lib/relay-types";

interface MobileSidebarProps {
  activeProfile: Profile;
  onProfileChange: (profileId: string) => void;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  selectedSession: string | null;
  runningSessions: Set<string>;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenSearch: () => void;
}

/**
 * Conteúdo por trás do drawer em "reveal" do iOS (docs/24) — largura própria
 * de `REVEAL_PUSH_PX` (via `var(--push)`, definido pelo `MobileShell`), não a
 * tela inteira: o que sobra escondido atrás do canvas nunca chega a
 * renderizar num container maior do que o espaço real que fica visível.
 *
 * Substitui `Sidebar.tsx` só no iOS — perfil vira segmented control (em vez
 * de dropdown), a busca (Cmd/Ctrl+K, docs/21) ganha um gatilho tocável (não
 * existe atalho de teclado em touch) e não tem botão de "nova conversa": só
 * o + da `MobileTopBar` cria conversa agora.
 */
export function MobileSidebar({
  activeProfile,
  onProfileChange,
  sessions,
  sessionsLoading,
  selectedSession,
  runningSessions,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onOpenSearch,
}: MobileSidebarProps) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  return (
    <div className="absolute inset-y-0 left-0 z-0 flex w-[var(--push)] min-w-0 flex-col gap-3.5 bg-bg-sidebar pt-14 pr-4 pb-6 pl-4">
      <div className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-6.5 shrink-0 items-center justify-center rounded-lg bg-primary font-mono text-sm font-bold text-background">
          &gt;
        </span>
        <span className="text-base font-semibold tracking-tight">ultron</span>
      </div>

      <div className="flex gap-0.5 rounded-xl bg-bg-elevated p-0.5">
        {PROFILES.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => onProfileChange(profile.id)}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] py-2 text-xs font-semibold transition-colors",
              profile.id === activeProfile.id ? "bg-card text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                profile.id === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
              )}
            />
            {profile.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="flex cursor-pointer items-center gap-2 rounded-xl bg-bg-elevated px-3 py-2.5 text-left text-sm text-muted-foreground"
      >
        <Search className="size-3.5 shrink-0" />
        Buscar sessão
      </button>

      {/* "Recentes" + lista viram um grupo próprio, com gap curto entre os
       * dois — o gap "grande" (docs/24) é o da coluna externa (gap-3.5),
       * entre a busca e este grupo, não entre o rótulo e o primeiro item. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <p className="px-1 font-mono text-[10.5px] tracking-wide text-text-faint uppercase">Recentes</p>

        <SessionList
          sessions={sessions}
          loading={sessionsLoading}
          selected={selectedSession}
          running={runningSessions}
          onSelect={onSelectSession}
          onRename={(id, title) => setRenaming({ id, title })}
          onDelete={onDeleteSession}
          size="lg"
        />
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
    </div>
  );
}
