import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PROFILES, type Profile } from "@/lib/profiles";

interface ProfileSwitcherProps {
  activeProfile: Profile;
  onChange: (profileId: string) => void;
}

export function ProfileSwitcher({ activeProfile, onChange }: ProfileSwitcherProps) {
  return (
    <Select value={activeProfile.id} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Perfil ativo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROFILES.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            <span
              className={cn(
                "inline-block size-2 shrink-0 rounded-full",
                profile.id === "trabalho" ? "bg-profile-work" : "bg-profile-personal",
              )}
            />
            {profile.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
