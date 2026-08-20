import { useEffect, useState } from "react";
import { fetchSessionNames } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

export function useSessionNames(profile: Profile): { sessions: string[]; loading: boolean } {
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSessionNames(profile.host, profile.relayPort)
      .then((names) => {
        if (!cancelled) setSessions(names);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao listar sessões", error);
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.host, profile.relayPort]);

  return { sessions, loading };
}
