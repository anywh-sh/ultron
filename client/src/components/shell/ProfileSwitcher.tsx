import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profiles";
import { useProfiles } from "@/hooks/useProfiles";

interface ProfileSwitcherProps {
  activeProfile: Profile;
  onChange: (profileId: string) => void;
}

export function ProfileSwitcher({ activeProfile, onChange }: ProfileSwitcherProps) {
  const profiles = useProfiles();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Perfil ativo"
          className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors hover:bg-bg-elevated"
        >
          <span
            className={cn(
              "inline-block size-2 shrink-0 rounded-full",
              activeProfile.id === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-left">{activeProfile.label}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {profiles.map((profile) => (
          <DropdownMenuItem key={profile.id} onSelect={() => onChange(profile.id)}>
            <Check className={cn("size-3.5", profile.id !== activeProfile.id && "opacity-0")} />
            <span
              className={cn(
                "inline-block size-2 shrink-0 rounded-full",
                profile.id === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
              )}
            />
            {profile.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
