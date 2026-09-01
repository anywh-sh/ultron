import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ultron:default-paths";

type DefaultPaths = Record<string, string>;

function readDefaultPaths(): DefaultPaths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Leitura avulsa (fora de componente React) do path padrão de um perfil —
 * usada por `ChatPanel` no momento em que uma aba nova recebe seu primeiro
 * `cwd_state`, sem precisar assinar o hook inteiro (que re-renderiza a cada
 * mudança em qualquer perfil). */
export function getDefaultPath(profileId: string): string | undefined {
  return readDefaultPaths()[profileId];
}

/**
 * Path que uma conversa nova de um perfil deve abrir, configurado em
 * Configurações. Chave única com todos os perfis juntos (ao contrário de
 * `useRecentFolders`, que já recebe um `profileId` concreto) porque a tela
 * de Configurações sempre edita a lista inteira de uma vez. Ausência de
 * entrada = nunca configurado, cai no default do relay daquele perfil
 * (`relay/src/paths.ts::defaultCwd`).
 */
export function useDefaultPaths() {
  const [paths, setPaths] = useState<DefaultPaths>(() => readDefaultPaths());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  }, [paths]);

  const setDefaultPath = useCallback((profileId: string, path: string) => {
    setPaths((prev) => ({ ...prev, [profileId]: path }));
  }, []);

  const clearDefaultPath = useCallback((profileId: string) => {
    setPaths((prev) => {
      if (!(profileId in prev)) return prev;
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
  }, []);

  return { paths, setDefaultPath, clearDefaultPath };
}
