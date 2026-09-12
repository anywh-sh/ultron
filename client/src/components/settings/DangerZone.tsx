import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isTailnetProfile, removeProfile, type Profile } from "@/lib/profiles";
import { deleteProfile } from "@/lib/relayClient";
import { clearProfileRevoked } from "@/lib/profileRevocation";

/** Picks another profile on the same relay as `scopedProfile` to run an
 * operation that must never execute through the profile's own relay
 * (deleting would make that relay disable its own systemd
 * instance mid-request). Exported for `SettingsDialog.test.tsx` — pure
 * logic, no need to render anything to exercise it.
 *
 * A tailnet profile never has a valid executor: each one is its own
 * isolated sandbox behind the "127.0.0.1" sidecar placeholder every
 * tailnet profile shares (see ThemeSection's registry comment), so a host
 * match there proves nothing about actually sharing a machine — in either
 * direction. `isTailnetProfile(scopedProfile)` rules out the first
 * direction (another tailnet profile looking like a same-host sibling);
 * excluding a tailnet `p` from the candidates rules out the second (a real
 * loopback direct profile matching a tailnet profile's placeholder host). */
export function findSameHostExecutor(scopedProfile: Profile, allProfiles: Profile[]): Profile | undefined {
  if (isTailnetProfile(scopedProfile)) return undefined;
  return allProfiles.find((p) => p.id !== scopedProfile.id && p.host === scopedProfile.host && !isTailnetProfile(p));
}

/** Exported for `SettingsDialog.test.tsx` — same reasoning as
 * `findSameHostExecutor` above: rendering the whole dialog just to reach
 * this section would drag in every other tab's own dependencies (theme
 * registry fetches, model preference, folder picker) for no benefit. */
export function DangerZone({
  scopedProfile,
  allProfiles,
  onProfileRemoved,
}: {
  scopedProfile: Profile;
  allProfiles: Profile[];
  onProfileRemoved: (removedId: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executor = findSameHostExecutor(scopedProfile, allProfiles);
  // A tailnet/brokered profile (paired via the dashboard's join code) has no
  // `/control/profiles` host to call at all — `findSameHostExecutor` always
  // returns `undefined` for one, by design (see its own comment). The
  // "Excluir do servidor" flow below genuinely doesn't apply to it, so it
  // gets its own local-only removal instead of a permanently disabled
  // button with a hint ("precisa de outro perfil no mesmo host") that would
  // be actively wrong here — no other profile could ever make that button
  // work for a tailnet profile.
  const tailnet = isTailnetProfile(scopedProfile);

  async function handleDeleteFromServer(): Promise<void> {
    if (!executor) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProfile(executor.host, executor.relayPort, scopedProfile.id);
      // Optimistic local removal for immediate feedback on this device —
      // `useActiveProfile`'s own reactive fallback handles switching away if
      // this happened to be the active profile, and every other device
      // picks up the removal on its next profile sync (useProfileSync).
      removeProfile(scopedProfile.id);
      onProfileRemoved(scopedProfile.id);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  function handleRemoveLocal(): void {
    // Nothing server-side to call — a paired device is disconnected from
    // the dashboard, which is what actually revokes it; this only clears
    // the local entry (same action `RevokedProfileBanner` offers once a
    // profile is already revoked — this is the same thing, offered
    // proactively instead of waiting for that to happen).
    if (!removeProfile(scopedProfile.id)) {
      setError("Não dá pra remover o único perfil que sobrou — adicione outro antes.");
      return;
    }
    clearProfileRevoked(scopedProfile.id);
    onProfileRemoved(scopedProfile.id);
    setConfirmOpen(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-3">
      <h3 className="text-sm font-medium text-destructive">Zona de risco</h3>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm">{tailnet ? "Remover perfil" : "Excluir do servidor"}</span>
          <span className="text-xs text-muted-foreground">
            {tailnet
              ? "Só remove a entrada deste dispositivo — desconectar de verdade se faz pelo painel da conta."
              : executor
                ? "Some de todos os dispositivos — a conta e o histórico continuam no host."
                : "Precisa de outro perfil no mesmo host pra executar a exclusão."}
          </span>
        </div>
        <Button variant="destructive" size="sm" disabled={!tailnet && !executor} onClick={() => setConfirmOpen(true)}>
          {tailnet ? "Remover" : "Excluir"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tailnet ? "Remover" : "Excluir"} perfil "{scopedProfile.label}"?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {tailnet
                ? "Remove só a entrada local deste dispositivo. Se o dispositivo ainda estiver ativo do lado da conta, ele continua existindo lá — desconectar de verdade é uma ação separada, no painel."
                : "Remove esse perfil de todos os dispositivos que apontam pra esse host. A conta Claude e o histórico de conversas continuam intactos na máquina."}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                if (tailnet) handleRemoveLocal();
                else void handleDeleteFromServer();
              }}
            >
              {deleting ? "Excluindo…" : tailnet ? "Remover" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
