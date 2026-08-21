import { useCallback, useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import type { SessionSummary } from "@/lib/relay-types";
import type { Profile } from "@/lib/profiles";

/**
 * O relay já lista as sessões ordenadas por última interação (mais recente
 * primeiro — `SessionStore.listTitled`), então não precisa reordenar aqui.
 */
export function useSessionNames(profile: Profile): {
  sessions: SessionSummary[];
  loading: boolean;
  upsertTitle: (id: string, title: string) => void;
  removeSession: (id: string) => void;
  touch: (id: string) => void;
} {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSessions(profile.host, profile.relayPort)
      .then((list) => {
        if (!cancelled) setSessions(list);
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
  // vez (insere no topo — é sempre a interação mais recente) e rename de uma
  // sessão já listada (atualiza no lugar, sem mexer na posição).
  const upsertTitle = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const index = prev.findIndex((session) => session.id === id);
      if (index === -1) return [{ id, title }, ...prev];
      const next = [...prev];
      next[index] = { ...next[index], title };
      return next;
    });
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== id));
  }, []);

  // Sobe uma sessão pro topo ao interagir com ela de novo (mandar mensagem
  // numa sessão antiga) — espelha `SessionStore.touch` do lado do relay,
  // mas otimista/local, pra não esperar um refetch. No-op se a sessão não
  // estiver na lista ainda (ex: turno inicial de uma sessão sem título).
  const touch = useCallback((id: string) => {
    setSessions((prev) => {
      const index = prev.findIndex((session) => session.id === id);
      if (index <= 0) return prev;
      const next = [...prev];
      const [session] = next.splice(index, 1);
      next.unshift(session);
      return next;
    });
  }, []);

  return { sessions, loading, upsertTitle, removeSession, touch };
}
