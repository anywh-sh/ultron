import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProfileRevoked } from "@/hooks/useProfileRevoked";
import { useProfiles } from "@/hooks/useProfiles";
import { clearProfileRevoked } from "@/lib/profileRevocation";
import { removeProfile, type Profile } from "@/lib/profiles";

/**
 * Surfaces the terminal state the four reconnect loops (chat, sessions/watch,
 * terminal, files — see `markProfileRevoked` call sites) land on when the
 * broker answers 410 for this profile's own identity: the account owner
 * disconnected this device from the dashboard, and no amount of retrying
 * will ever succeed again. Chosen deliberately over auto-removing the
 * profile — a silent disappearance would be more confusing than an
 * explicit "this happened, here's what to do about it".
 *
 * Only ever renders for `profile.id` still being in the local list — once
 * removed, `useProfiles()` (wherever renders the switcher) stops offering
 * it and this stops mounting for it at all.
 */
export function RevokedProfileBanner({ profile }: { profile: Profile }) {
  const revoked = useProfileRevoked(profile.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!revoked) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
      <span>
        O dispositivo <strong>{profile.label}</strong> foi desconectado da conta — a conexão não vai mais funcionar.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
          Remover perfil
        </Button>
        <button
          type="button"
          aria-label="Dispensar aviso"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => clearProfileRevoked(profile.id)}
        >
          <X className="size-4" />
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o perfil "{profile.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esse dispositivo já foi desconectado da conta pelo painel — removê-lo aqui só limpa a entrada
              local, sem efeito nenhum do lado do servidor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                // `removeProfile` refuses to empty the list (profiles.ts) —
                // the only way this fails is being the sole profile left,
                // which needs a different profile added first, not a retry.
                if (!removeProfile(profile.id)) {
                  setError("Não dá pra remover o único perfil que sobrou — adicione outro antes.");
                  return;
                }
                clearProfileRevoked(profile.id);
                setConfirmOpen(false);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One banner per revoked profile, not just `activeProfile` — a background
 * chat tab keeps its own `RelayClient` alive regardless of which profile the
 * sidebar has selected (`TabBar`'s `forceMount`, App.tsx), so its revocation
 * can be detected while the user is looking at a different profile entirely.
 * Gating the banner on `activeProfile` meant that detection was silent until
 * the user happened to switch back (journal/67) — this renders one per
 * profile in the list, and `RevokedProfileBanner` itself already no-ops for
 * whichever ones aren't revoked.
 */
export function RevokedProfileBanners() {
  const profiles = useProfiles();
  return (
    <>
      {profiles.map((profile) => (
        <RevokedProfileBanner key={profile.id} profile={profile} />
      ))}
    </>
  );
}
