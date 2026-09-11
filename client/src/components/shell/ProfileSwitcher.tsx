import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Link2 } from "lucide-react";
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
import { AddProfileDialog } from "@/components/shell/AddProfileDialog";
import { AddRemoteMachineDialog } from "@/components/shell/AddRemoteMachineDialog";

interface ProfileSwitcherProps {
  activeProfile: Profile;
  /** Passed in rather than resolved here: the sync that answers it has to
   * keep running with this component unmounted (see `App`). */
  supported: boolean;
  onChange: (profileId: string) => void;
}

export function ProfileSwitcher({ activeProfile, supported, onChange }: ProfileSwitcherProps) {
  const profiles = useProfiles();
  const [addOpen, setAddOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

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
          <DropdownMenuSeparator />
          {/* Ungated on `supported`, unlike "Adicionar perfil" below: that
              one asks the active host to create an account and needs a
              working connection to it, while this one is how you get a
              connection in the first place — a fresh install with nothing
              reachable is exactly when it's needed most. */}
          <DropdownMenuItem onSelect={() => setPairOpen(true)}>
            <Link2 className="size-3.5" />
            Adicionar máquina remota
          </DropdownMenuItem>
          {supported && (
            <DropdownMenuItem onSelect={() => setAddOpen(true)}>
              <Plus className="size-3.5" />
              Adicionar perfil
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AddRemoteMachineDialog open={pairOpen} onOpenChange={setPairOpen} />

      {supported && (
        <AddProfileDialog open={addOpen} onOpenChange={setAddOpen} activeProfile={activeProfile} />
      )}
    </>
  );
}
