import { useSyncExternalStore } from "react";
import { isProfileRevoked, subscribeProfileRevocation } from "@/lib/profileRevocation";

/** Reactive read of whether `profileId`'s connection was permanently
 * revoked — re-renders whenever any of the four reconnect loops (chat,
 * sessions/watch, terminal, files) marks it, or it's cleared (profile
 * removed/re-paired). */
export function useProfileRevoked(profileId: string): boolean {
  return useSyncExternalStore(
    subscribeProfileRevocation,
    () => isProfileRevoked(profileId),
  );
}
