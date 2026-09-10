import { useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import { resolveConnection } from "@/lib/connectionResolver";
import type { SessionSummary } from "@/lib/relay-types";
import { useProfiles } from "@/hooks/useProfiles";

/**
 * Sessions from BOTH profiles — sibling of `useSessionNames.ts` (which only
 * fetches the active profile), to feed the global search (Ctrl/Cmd+K —
 * docs/21). `enabled` controls when it fetches: fresh on every dialog
 * opening, no continuous background polling.
 */
export function useAllSessionNames(enabled: boolean): {
  byProfile: Record<string, SessionSummary[]>;
  loading: boolean;
} {
  const profiles = useProfiles();
  const [byProfile, setByProfile] = useState<Record<string, SessionSummary[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);

    Promise.all(
      profiles.map((profile) =>
        resolveConnection(profile)
          .then(({ host, port, token }) => fetchSessions(host, port, token))
          .then((sessions): [string, SessionSummary[]] => [profile.id, sessions])
          .catch((error: unknown) => {
            console.error("[anywh] failed to list sessions", profile.id, error);
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
  }, [enabled, profiles]);

  return { byProfile, loading };
}
