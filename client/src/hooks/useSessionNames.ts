import { useCallback, useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import type { SessionSummary } from "@/lib/relay-types";
import type { Profile } from "@/lib/profiles";

/**
 * O relay lista sessões em ordem de criação (mais antiga primeiro — Map de
 * inserção em `SessionManager`); invertemos aqui pra exibir mais recente
 * primeiro, que é o que faz sentido numa lista de conversas.
 */
export function useSessionNames(profile: Profile): {
  sessions: SessionSummary[];
  loading: boolean;
  upsertTitle: (id: string, title: string) => void;
} {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSessions(profile.host, profile.relayPort)
      .then((list) => {
        if (!cancelled) setSessions([...list].reverse());
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

  // Atualização otimista: uma sessão só existe de fato na lista do relay
  // quando ganha título (primeiro prompt processado, ou rename manual) — sem
  // isso, ela só apareceria na sidebar depois de um refetch (troca de
  // perfil ou reload). Cobre os dois casos: título inferido pela primeira
  // vez (insere) e rename de uma sessão já listada (atualiza no lugar).
  const upsertTitle = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const index = prev.findIndex((session) => session.id === id);
      if (index === -1) return [{ id, title }, ...prev];
      const next = [...prev];
      next[index] = { ...next[index], title };
      return next;
    });
  }, []);

  return { sessions, loading, upsertTitle };
}
