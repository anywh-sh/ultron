import { useCallback, useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { BrokerRevokedError } from "@/lib/tailnetBroker";
import type { SessionSummary } from "@/lib/relay-types";
import type { Profile } from "@/lib/profiles";

/**
 * The relay already lists sessions ordered by last interaction (most recent
 * first — `SessionStore.listTitled`), so there's no need to reorder here.
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
    resolveConnection(profile)
      .then(({ host, port, token }) => fetchSessions(host, port, token))
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((error: unknown) => {
        console.error("[anywh] failed to list sessions", error);
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    profile.id,
    profile.host,
    profile.relayPort,
    profile.tailnetAuthKey,
    profile.tailnetControlUrl,
    profile.tailnetTarget,
    profile.brokerUrl,
    profile.brokerNodeId,
  ]);

  // Optimistic update: a session only actually exists in the relay's list
  // once it gets a title (first prompt processed, or manual rename) — without
  // this, it would only show up in the sidebar after a refetch (profile
  // switch or reload). Covers both cases: title inferred for the first
  // time (inserts at the top — it's always the most recent interaction) and rename of an
  // already-listed session (updates in place, without touching its position).
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

  // Moves a session to the top when interacting with it again (sending a message
  // in an old session) — mirrors `SessionStore.touch` on the relay side,
  // but optimistic/local, to avoid waiting for a refetch. No-op if the session isn't
  // in the list yet (e.g. initial turn of a session with no title).
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

  // Keeps the list live across devices: a session created (and titled) or
  // renamed/deleted on ANOTHER client connected to the same relay/profile
  // (e.g. a conversation started on mobile) only reaches this device through
  // this socket — `upsertTitle`/`removeSession` elsewhere in the app are
  // wired to a specific open tab's `RelayClient`, which this device may not
  // have for a session it never opened. Without this, the sidebar only
  // picked up other devices' changes on the next profile switch or reload.
  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    // A tailnet connection needs its own fresh, unspent connect token on
    // every new TCP connection (journal/49 D4, journal/62) — a reconnect
    // after `close` is a brand-new one, so this resolves again on every
    // call instead of reusing whatever `connect()` used the first time.
    function connect(): void {
      if (cancelled) return;
      resolveConnection(profile)
        .then(({ host, port, token }) => {
          if (cancelled) return;
          const query = token ? `?token=${encodeURIComponent(token)}` : "";
          const ws = new WebSocket(`ws://${host}:${String(port)}/sessions/watch${query}`);
          socket = ws;
          ws.addEventListener("message", (event) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(event.data as string);
            } catch {
              return;
            }
            if (typeof parsed !== "object" || parsed === null) return;
            const { type, id, title } = parsed as { type?: unknown; id?: unknown; title?: unknown };
            if (typeof id !== "string") return;
            if (type === "session_list_upsert" && typeof title === "string") upsertTitle(id, title);
            else if (type === "session_list_removed") removeSession(id);
          });
          ws.addEventListener("close", () => {
            if (socket !== ws || cancelled) return;
            reconnectTimer = window.setTimeout(connect, 2000);
          });
        })
        .catch((error: unknown) => {
          console.error("[anywh] failed to resolve a connection for sessions/watch", error);
          if (cancelled) return;
          // Terminal — this device's connection was deliberately revoked and
          // will never succeed again, unlike every other reason this could
          // fail (network blip, relay down), which are worth retrying.
          if (error instanceof BrokerRevokedError) return;
          reconnectTimer = window.setTimeout(connect, 2000);
        });
    }
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    profile.id,
    profile.host,
    profile.relayPort,
    profile.tailnetAuthKey,
    profile.tailnetControlUrl,
    profile.tailnetTarget,
    profile.brokerUrl,
    profile.brokerNodeId,
    upsertTitle,
    removeSession,
  ]);

  return { sessions, loading, upsertTitle, removeSession, touch };
}
