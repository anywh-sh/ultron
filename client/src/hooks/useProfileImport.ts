import { useEffect, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { inTauri } from "@/lib/tauri";
import { importProfile, parseImportProfileUrl } from "@/lib/profileImport";

/**
 * Listens for `ultron://import-profile` deep links (see profileImport.ts
 * for the URL format, src-tauri/tauri.conf.json for the OS-registered
 * scheme) and turns each into a new local profile, handing its id back so
 * the caller can switch to it — same "registration exists, caller decides
 * what to do next" shape as `useNotificationClick`.
 *
 * Two delivery paths, both handled: `getCurrent()` covers a cold launch
 * (the OS started the app *because* of the link — the common case for a
 * pairing flow, since the app usually isn't running yet), `onOpenUrl` covers
 * the link arriving while the app is already open. Per the plugin's own
 * docs, `onOpenUrl` needs the single-instance plugin on Windows/Linux to
 * fire at all there (the OS spawns a second process and hands it the URL as
 * a CLI argument instead of notifying the running one) — not wired up here,
 * so on those two platforms only the cold-launch path is covered today.
 */
export function useProfileImport(onImported: (profileId: string) => void): void {
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  useEffect(() => {
    if (!inTauri()) return;

    function handle(urls: string[]): void {
      for (const url of urls) {
        const params = parseImportProfileUrl(url);
        if (!params) {
          console.error(`useProfileImport: ignoring unrecognized deep link: ${url}`);
          continue;
        }
        // journal/62 F4: a tailnet-mode import redeems the join code over
        // the network (claimTailnetBundle) before there's a profile to add
        // at all — no profile (and no `onImported` call) on failure, same
        // as an unrecognized link above.
        importProfile(params)
          .then((id) => onImportedRef.current(id))
          .catch((err: unknown) => {
            console.error(`useProfileImport: failed to import profile from deep link: ${url}`, err);
          });
      }
    }

    void getCurrent().then((urls) => {
      if (urls) handle(urls);
    });

    const unlistenPromise = onOpenUrl(handle);

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
