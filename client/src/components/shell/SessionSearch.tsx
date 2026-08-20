import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useAllSessionNames } from "@/hooks/useAllSessionNames";
import { PROFILES } from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface SessionSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (profileId: string, sessionName: string) => void;
}

export function SessionSearch({ open, onOpenChange, onSelectSession }: SessionSearchProps) {
  const { byProfile, loading } = useAllSessionNames(open);

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
        {PROFILES.map((profile) => {
          const sessions = byProfile[profile.id] ?? [];
          if (sessions.length === 0) return null;

          return (
            <CommandGroup key={profile.id} heading={profile.label}>
              {sessions.map((name) => (
                <CommandItem
                  key={name}
                  value={`${profile.label} ${name}`}
                  onSelect={() => {
                    onSelectSession(profile.id, name);
                    onOpenChange(false);
                  }}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      profile.id === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
                    )}
                  />
                  <span className="truncate font-mono">{name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
