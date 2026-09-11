import { useCallback, useEffect, useState } from "react";
import { fetchSessions } from "@/lib/relayClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { BrokerRevokedError } from "@/lib/tailnetBroker";
import { markProfileRevoked } from "@/lib/profileRevocation";
import type { SessionSummary } from "@/lib/relay-types";
import type { Profile } from "@/lib/profiles";

interface SessionsState {
  /** Which profile `sessions`/`loading`/`error` actually describe — read
   * against `profile.id` on every render (see below) so a profile switch
   * resets the visible state in the SAME render, not on the next one. */
  profileId: string;
  sessions: SessionSummary[];
  loading: boolean;
  error: boolean;
}

function initialState(profileId: string): SessionsState {
  return { profileId, sessions: [], loading: true, error: false };
}

/**
 * The relay already lists sessions ordered by last interaction (most recent
 * first — `SessionStore.listTitled`), so there's no need to reorder here.
 */
export function useSessionNames(profile: Profile): {
  sessions: SessionSummary[];
  loading: boolean;
  error: boolean;
  upsertTitle: (id: string, title: string) => void;
  removeSession: (id: string) => void;
  touch: (id: string) => void;
  reload: () => void;
} {
  const [state, setState] = useState<SessionsState>(() => initialState(profile.id));
  const [reloadTick, setReloadTick] = useState(0);

  // Adjusts state during render (React's own sanctioned pattern for
  // "reset when a prop changes") rather than in an effect: a switch lands
  // on the skeleton in this exact render, instead of one frame showing the
  // previous profile's sessions while the effect below catches up (the bug:
  // the old code only ever called `setLoading(true)`, which never cleared
  // `sessions`). Stamped by `profile.id` alone, not the effect's full deps
  // list below (which also includes `host`/`brokerUrl`) — a benign resync
  // from `useProfileSync` changing one of those must refetch without
  // wiping the list a user is currently looking at.
  if (state.profileId !== profile.id) setState(initialState(profile.id));

  useEffect(() => {
    let cancelled = false;
    const profileId = profile.id;
    resolveConnection(profile)
      .then(({ host, port, token }) => fetchSessions(host, port, token))
      .then((list) => {
        if (cancelled) return;
        setState((prev) => (prev.profileId === profileId ? { ...prev, sessions: list, loading: false, error: false } : prev));
      })
      .catch((error: unknown) => {
        console.error("[anywh] failed to list sessions", error);
        if (error instanceof BrokerRevokedError) markProfileRevoked(profile.id);
        if (cancelled) return;
        setState((prev) => (prev.profileId === profileId ? { ...prev, loading: false, error: true } : prev));
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
    reloadTick,
  ]);

  /** Manual retry (SessionList's "Tentar novamente") — flips back to the
   * skeleton right away (unlike the effect above, which never touches
   * `loading` on its own for a same-profile refetch) and bumps `reloadTick`
   * to make the effect run again with the exact same profile fields. */
  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: false }));
    setReloadTick((tick) => tick + 1);
  }, []);

  // Optimistic update: a session only actually exists in the relay's list
  // once it gets a title (first prompt processed, or manual rename) — without
  // this, it would only show up in the sidebar after a refetch (profile
  // switch or reload). Covers both cases: title inferred for the first
  // time (inserts at the top — it's always the most recent interaction) and rename of an
  // already-listed session (updates in place, without touching its position).
  const upsertTitle = useCallback((id: string, title: string) => {
    setState((prev) => {
      const index = prev.sessions.findIndex((session) => session.id === id);
      const sessions =
        index === -1
          ? [{ id, title }, ...prev.sessions]
          : prev.sessions.map((session, i) => (i === index ? { ...session, title } : session));
      return { ...prev, sessions };
    });
  }, []);

  const removeSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((session) => session.id !== id) }));
  }, []);

  // Moves a session to the top when interacting with it again (sending a message
  // in an old session) — mirrors `SessionStore.touch` on the relay side,
  // but optimistic/local, to avoid waiting for a refetch. No-op if the session isn't
  // in the list yet (e.g. initial turn of a session with no title).
  const touch = useCallback((id: string) => {
    setState((prev) => {
      const index = prev.sessions.findIndex((session) => session.id === id);
      if (index <= 0) return prev;
      const sessions = [...prev.sessions];
      const [session] = sessions.splice(index, 1);
      sessions.unshift(session);
      return { ...prev, sessions };
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
          if (error instanceof BrokerRevokedError) {
            markProfileRevoked(profile.id);
            return;
          }
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

  return { sessions: state.sessions, loading: state.loading, error: state.error, upsertTitle, removeSession, touch, reload };
}
