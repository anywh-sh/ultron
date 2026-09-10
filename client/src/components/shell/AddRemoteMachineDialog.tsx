import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parsePairingCode } from "@/lib/pairingCode";
import { importFromPairingCode } from "@/lib/profileImport";

interface AddRemoteMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new profile's id so the caller can switch to it — same
   * contract as `useProfileImport`'s callback, since this is the same import
   * reached by typing instead of by deep link. */
  onImported: (profileId: string) => void;
}

/**
 * Redeems a typed `<join-code>@<host>` pairing code (pairingCode.ts) into a
 * new remote profile.
 *
 * This is the deep link's fallback, and it exists because the deep link
 * can't be the only path: it's desktop-only, and on Linux/Windows it only
 * fires on a cold launch. Whoever is holding a code with the app already
 * open — or on a platform where `ultron://` was never registered — needs
 * somewhere to put it.
 *
 * Deliberately *not* `AddProfileDialog`: that one creates another Claude
 * account on the relay this client is already talking to (journal/45), and
 * needs a working connection to do it. This one has no connection yet —
 * it's how you get the first one to a machine you can't otherwise reach.
 */
export function AddRemoteMachineDialog({ open, onOpenChange, onImported }: AddRemoteMachineDialogProps) {
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setCode("");
    setError(null);
    setPairing(false);
  }, [open]);

  // Parsed up front so the host is on screen before anything is sent: the
  // code names the machine that's about to receive this device's public key,
  // and that's worth seeing rather than trusting blind.
  const parsed = code.trim() ? parsePairingCode(code) : null;
  const canSubmit = Boolean(label.trim() && parsed) && !pairing;

  async function handlePair(): Promise<void> {
    if (!canSubmit) return;
    setPairing(true);
    setError(null);
    try {
      const id = await importFromPairingCode(label.trim(), code);
      onOpenChange(false);
      onImported(id);
    } catch (err) {
      console.error("[ultron] failed to pair from code", err);
      setError(
        "Não foi possível parear com esse código. Ele pode ter expirado, já ter sido usado, ou a máquina pode estar fora do ar.",
      );
    } finally {
      setPairing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar máquina remota</DialogTitle>
          <DialogDescription>
            Cole o código de pareamento gerado pela máquina que você quer alcançar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="add-remote-label">
              Nome
            </label>
            <input
              id="add-remote-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
              placeholder="Ex.: Servidor de casa"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="add-remote-code">
              Código de pareamento
            </label>
            <input
              id="add-remote-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-ring"
              placeholder="ABCDEF-GHJKMNPQ@exemplo.com"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {parsed && (
            <p className="text-xs text-muted-foreground">
              Vai parear com <span className="font-mono text-foreground">{parsed.origin}</span>
            </p>
          )}
          {code.trim() && !parsed && (
            <p className="text-xs text-muted-foreground">
              O código tem o formato <span className="font-mono">CÓDIGO@servidor</span>.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handlePair()}>
            {pairing ? "Pareando…" : "Parear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
