import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAllSessionNames } from "@/hooks/useAllSessionNames";
import { useProfiles } from "@/hooks/useProfiles";
import { profileColorClass } from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface SessionSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (profileId: string, sessionId: string, title: string) => void;
}

export function SessionSearch({ open, onOpenChange, onSelectSession }: SessionSearchProps) {
  const { byProfile, loading } = useAllSessionNames(open);
  const profiles = useProfiles();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar sessão"
      description="Busque uma sessão por nome, dos dois perfis."
    >
      <CommandInput placeholder="Buscar sessão…" />
      <CommandList>
        <CommandEmpty>{loading ? "Buscando…" : "Nenhuma sessão encontrada."}</CommandEmpty>
        {profiles.map((profile) => {
          const sessions = byProfile[profile.id] ?? [];
          if (sessions.length === 0) return null;

          return (
            <CommandGroup key={profile.id} heading={profile.label}>
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`${profile.label} ${session.title}`}
                  onSelect={() => {
                    onSelectSession(profile.id, session.id, session.title);
                    onOpenChange(false);
                  }}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      profileColorClass(profile.id),
                    )}
                  />
                  <span className="truncate font-mono">{session.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
