import { useCallback, useEffect, useState } from "react";
import { fetchSessionNames } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

/**
 * O relay lista sessões em ordem de criação (mais antiga primeiro — Map de
 * inserção em `SessionManager`); invertemos aqui pra exibir mais recente
 * primeiro, que é o que faz sentido numa lista de conversas.
 */
export function useSessionNames(profile: Profile): {
  sessions: string[];
  loading: boolean;
  addSession: (name: string) => void;
} {
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSessionNames(profile.host, profile.relayPort)
      .then((names) => {
        if (!cancelled) setSessions([...names].reverse());
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

  // Atualização otimista: uma sessão nova só existe de fato no relay quando
  // a conexão WS abre (SessionManager.getOrCreate), então o fetch acima já
  // rodou antes disso acontecer. Sem isso a sessão nova só aparecia na lista
  // depois de um refetch (troca de perfil ou reload).
  const addSession = useCallback((name: string) => {
    setSessions((prev) => (prev.includes(name) ? prev : [name, ...prev]));
  }, []);

  return { sessions, loading, addSession };
}
