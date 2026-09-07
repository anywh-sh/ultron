import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { profileColorClass, type Profile } from "@/lib/profiles";
import { useProfiles } from "@/hooks/useProfiles";
import { useProfileSync } from "@/hooks/useProfileSync";
import { AddProfileDialog } from "@/components/shell/AddProfileDialog";

interface ProfileSwitcherProps {
  activeProfile: Profile;
  onChange: (profileId: string) => void;
}

export function ProfileSwitcher({ activeProfile, onChange }: ProfileSwitcherProps) {
  const profiles = useProfiles();
  const { supported } = useProfileSync(activeProfile);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      {/* modal={false}: Radix traps focus + pointer-events on the body while
          a modal menu is open, and WKWebView (Tauri on macOS/iOS) fails to
          restore that when this item opens AddProfileDialog on top of it —
          same fix as WorkingDirectoryButton/ModelButton. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Perfil ativo"
            className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors hover:bg-bg-elevated"
          >
            <span
              className={cn(
                "inline-block size-2 shrink-0 rounded-full",
                profileColorClass(activeProfile.id),
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
                  profileColorClass(profile.id),
                )}
              />
              {profile.label}
            </DropdownMenuItem>
          ))}
          {supported && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAddOpen(true)}>
                <Plus className="size-3.5" />
                Adicionar perfil
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {supported && (
        <AddProfileDialog open={addOpen} onOpenChange={setAddOpen} activeProfile={activeProfile} />
      )}
    </>
  );
}
