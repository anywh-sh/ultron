import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionList } from "@/components/shell/SessionList";
import { RenameSessionDialog } from "@/components/shell/RenameSessionDialog";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import type { Profile } from "@/lib/profiles";
import type { SessionSummary } from "@/lib/relay-types";
import { shortcutLabel } from "@/lib/platform";

interface SidebarProps {
  activeProfile: Profile;
  onProfileChange: (profileId: string) => void;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  selectedSession: string | null;
  runningSessions: Set<string>;
  onSelectSession: (id: string) => void;
  onNewConversation: () => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
}

export function Sidebar({
  activeProfile,
  onProfileChange,
  sessions,
  sessionsLoading,
  selectedSession,
  runningSessions,
  onSelectSession,
  onNewConversation,
  onRenameSession,
  onDeleteSession,
}: SidebarProps) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-sidebar">
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="px-1 font-mono text-sm text-muted-foreground">ultron▍</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onNewConversation} aria-label="Nova conversa">
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Nova conversa
            <TooltipShortcut>{shortcutLabel("N")}</TooltipShortcut>
          </TooltipContent>
        </Tooltip>
      </div>

      <SessionList
        sessions={sessions}
        loading={sessionsLoading}
        selected={selectedSession}
        running={runningSessions}
        onSelect={onSelectSession}
        onRename={(id, title) => setRenaming({ id, title })}
        onDelete={onDeleteSession}
      />

      <div className="border-t border-border-soft p-2">
        <ProfileSwitcher activeProfile={activeProfile} onChange={onProfileChange} />
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
