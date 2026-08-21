import { useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import type { SessionSummary } from "@/lib/relay-types";
import { PROFILES } from "@/lib/profiles";

/**
 * Sessões dos DOIS perfis — irmão de `useSessionNames.ts` (que só busca o
 * perfil ativo), pra alimentar a busca global (Ctrl/Cmd+K — docs/21).
 * `enabled` controla quando busca: fresh a cada abertura do diálogo, sem
 * polling contínuo em background.
 */
export function useAllSessionNames(enabled: boolean): {
  byProfile: Record<string, SessionSummary[]>;
  loading: boolean;
} {
  const [byProfile, setByProfile] = useState<Record<string, SessionSummary[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);

    Promise.all(
      PROFILES.map((profile) =>
        fetchSessions(profile.host, profile.relayPort)
          .then((sessions): [string, SessionSummary[]] => [profile.id, sessions])
          .catch((error: unknown) => {
            console.error("[ultron] falha ao listar sessões", profile.id, error);
            return [profile.id, []] as [string, SessionSummary[]];
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setByProfile(Object.fromEntries(results));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { byProfile, loading };
}
