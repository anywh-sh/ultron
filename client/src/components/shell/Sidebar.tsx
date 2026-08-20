import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionList } from "@/components/shell/SessionList";
import { ProfileSwitcher } from "@/components/shell/ProfileSwitcher";
import type { Profile } from "@/lib/profiles";
import { shortcutLabel } from "@/lib/platform";

interface SidebarProps {
  activeProfile: Profile;
  onProfileChange: (profileId: string) => void;
  sessions: string[];
  sessionsLoading: boolean;
  selectedSession: string | null;
  onSelectSession: (name: string) => void;
  onNewConversation: () => void;
}

export function Sidebar({
  activeProfile,
  onProfileChange,
  sessions,
  sessionsLoading,
  selectedSession,
  onSelectSession,
  onNewConversation,
}: SidebarProps) {
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
        onSelect={onSelectSession}
      />

      <div className="border-t border-border-soft p-2">
        <ProfileSwitcher activeProfile={activeProfile} onChange={onProfileChange} />
      </div>
    </div>
  );
}
