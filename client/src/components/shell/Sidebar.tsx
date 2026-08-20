import { PanelLeftClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionList } from "@/components/shell/SessionList";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import type { Profile } from "@/lib/profiles";

interface SidebarProps {
  activeProfile: Profile;
  onProfileChange: (profileId: string) => void;
  sessions: string[];
  sessionsLoading: boolean;
  selectedSession: string | null;
  onSelectSession: (name: string) => void;
  onNewConversation: () => void;
  /** Omitido no modo drawer (compacto) — o Sheet já tem seu próprio fechamento. */
  onCollapse?: () => void;
}

export function Sidebar({
  activeProfile,
  onProfileChange,
  sessions,
  sessionsLoading,
  selectedSession,
  onSelectSession,
  onNewConversation,
  onCollapse,
}: SidebarProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-sidebar">
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="px-1 font-mono text-sm text-muted-foreground">ultron▍</span>
        {onCollapse && (
          <Button variant="ghost" size="icon" onClick={onCollapse} aria-label="Colapsar barra lateral">
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>

      <div className="px-2 pb-2">
        <Button variant="secondary" className="w-full justify-start gap-2" onClick={onNewConversation}>
          <Plus className="size-4" />
          Nova conversa
        </Button>
      </div>

      <SessionList
        sessions={sessions}
        loading={sessionsLoading}
        selected={selectedSession}
        onSelect={onSelectSession}
      />

      <div className="border-t border-border-soft p-2">
        <ProfileSwitcher activeProfile={activeProfile} onChange={onProfileChange} />
      </div>
    </div>
  );
}
