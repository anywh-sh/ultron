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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addProfile, profileColorClassForIndex, type Profile } from "@/lib/profiles";
import { createProfile, validateProfile } from "@/lib/relayClient";
import type { RemoteProfile } from "@/lib/relay-types";
import { cn } from "@/lib/utils";

interface AddProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose relay hosts both calls in "Criar" — the only machine the client
   * already knows how to reach (docs/45 Fase 5c). A new profile always
   * lives on this same host, just a different account/port. */
  activeProfile: Profile;
  /** Known to `activeProfile.host` but not yet added to this device — see
   * `useControlProfiles`. */
  importable: RemoteProfile[];
}

function ImportRow({ entry }: { entry: RemoteProfile }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("inline-block size-2 shrink-0 rounded-full", profileColorClassForIndex(entry.colorIndex))}
        />
        <span className="truncate text-sm font-medium">{entry.label}</span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          addProfile({
            id: entry.id,
            label: entry.label,
            host: entry.host,
            relayPort: entry.port,
            colorIndex: entry.colorIndex,
          })
        }
      >
        Adicionar
      </Button>
    </div>
  );
}

/**
 * Two-mode dialog opened from `ProfileSwitcher`'s "Adicionar perfil" item —
 * import a profile the active host already knows about (the normal path on
 * a second device), or create a brand new one on that same host. Only
 * rendered when `useControlProfiles` reports the active host actually runs
 * the control API (docs/45 Fase 5a) — see `ProfileSwitcher`.
 */
export function AddProfileDialog({ open, onOpenChange, activeProfile, importable }: AddProfileDialogProps) {
  const [mode, setMode] = useState<"import" | "create">("import");
  const [label, setLabel] = useState("");
  const [homePath, setHomePath] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ email?: string; subscriptionType?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collidesWith, setCollidesWith] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(importable.length > 0 ? "import" : "create");
    setLabel("");
    setHomePath("");
    setValidation(null);
    setError(null);
    setCollidesWith(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A field the user already validated changing again means "Criar" needs
  // another "Verificar" first — otherwise a typo fixed after a failed check
  // would silently reuse the previous (wrong) result.
  useEffect(() => {
    setValidation(null);
    setError(null);
    setCollidesWith(null);
  }, [homePath]);

  async function handleVerify(): Promise<void> {
    setValidating(true);
    setError(null);
    setCollidesWith(null);
    setValidation(null);
    try {
      const result = await validateProfile(activeProfile.host, activeProfile.relayPort, homePath.trim() || undefined);
      if (result.collidesWith) {
        setCollidesWith(result.collidesWith);
        return;
      }
      if (!result.loggedIn) {
        const homeForCommand = homePath.trim() || "<caminho>";
        setError(`Não logado. Rode no terminal do host: HOME=${homeForCommand} claude login`);
        return;
      }
      setValidation({ email: result.email, subscriptionType: result.subscriptionType });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  }

  async function handleCreate(): Promise<void> {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || !validation) return;
    setCreating(true);
    try {
      const created = await createProfile(activeProfile.host, activeProfile.relayPort, trimmedLabel, homePath.trim() || undefined);
      addProfile({
        id: created.id,
        label: created.label,
        host: created.host,
        relayPort: created.port,
        colorIndex: created.colorIndex,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar perfil</DialogTitle>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as "import" | "create")}>
          <TabsList className="w-full">
            <TabsTrigger value="import" className="flex-1">
              Importar
            </TabsTrigger>
            <TabsTrigger value="create" className="flex-1">
              Criar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="flex flex-col gap-2">
            {importable.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum perfil novo encontrado neste host.
              </p>
            ) : (
              importable.map((entry) => <ImportRow key={entry.id} entry={entry} />)
            )}
          </TabsContent>

          <TabsContent value="create" className="flex flex-col gap-3">
            <DialogDescription>
              Garanta que sua sessão do Claude está logada na máquina que hospeda o serviço.
            </DialogDescription>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="add-profile-label">
                Nome
              </label>
              <input
                id="add-profile-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
                placeholder="Ex.: Cliente X"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="add-profile-home">
                Caminho de configuração (opcional — vazio usa a conta padrão da máquina)
              </label>
              <input
                id="add-profile-home"
                value={homePath}
                onChange={(event) => setHomePath(event.target.value)}
                className="rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-ring"
                placeholder="/home/user/.ultron-cliente-x-home"
                spellCheck={false}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {collidesWith && (
              <p className="text-sm text-destructive">
                Esse caminho já está em uso pelo perfil "{collidesWith}" — use a aba Importar pra adicioná-lo.
              </p>
            )}
            {validation && (
              <p className="text-sm text-foreground">
                Conta confirmada{validation.email ? `: ${validation.email}` : ""}
                {validation.subscriptionType ? ` (${validation.subscriptionType})` : ""}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" disabled={validating} onClick={() => void handleVerify()}>
                {validating ? "Verificando…" : "Verificar"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {mode === "create" && (
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" size="sm" disabled={!validation || !label.trim() || creating} onClick={() => void handleCreate()}>
              {creating ? "Criando…" : "Criar"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
