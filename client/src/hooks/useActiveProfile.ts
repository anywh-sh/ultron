import { useCallback, useState } from "react";
import { PROFILES, findProfile, type Profile } from "@/lib/profiles";

const STORAGE_KEY = "ultron:last-profile";

function readInitialProfileId(override: string | null): string {
  if (override && findProfile(override)) return override;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && findProfile(saved)) return saved;
  return PROFILES[0].id;
}

export function useActiveProfile(queryOverride: string | null): [Profile, (id: string) => void] {
  const [profileId, setProfileId] = useState(() => readInitialProfileId(queryOverride));

  const setActiveProfileId = useCallback((id: string) => {
    setProfileId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return [findProfile(profileId) ?? PROFILES[0], setActiveProfileId];
}
