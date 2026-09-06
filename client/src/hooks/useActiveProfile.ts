import { useCallback, useState } from "react";
import { findProfile, getProfiles, type Profile } from "@/lib/profiles";
import { useProfiles } from "@/hooks/useProfiles";

const STORAGE_KEY = "ultron:last-profile";

function readInitialProfileId(override: string | null): string {
  if (override && findProfile(override)) return override;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && findProfile(saved)) return saved;
  return getProfiles()[0].id;
}

export function useActiveProfile(queryOverride: string | null): [Profile, (id: string) => void] {
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => readInitialProfileId(queryOverride));

  const setActiveProfileId = useCallback((id: string) => {
    setProfileId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return [profiles.find((profile) => profile.id === profileId) ?? profiles[0], setActiveProfileId];
}
