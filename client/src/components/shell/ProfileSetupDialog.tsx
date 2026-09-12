import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProfileSetupStepList } from "@/components/shell/ProfileSetupStepList";
import type { SetupState } from "@/lib/profileSetup";

interface ProfileSetupDialogProps {
  state: SetupState | null;
  /** Requests waiting behind this one — rendered as a small footer note,
   * never as a reason to disable anything: the queue advances on its own
   * once this request is dismissed or completed. */
  queuedCount: number;
  onContinue: (profileId: string) => void;
  onUseExisting: (existingProfileId: string) => void;
  onRetry: () => void;
  onDismiss: () => void;
}

function titleFor(state: SetupState): string {
  switch (state.status) {
    case "claiming":
    case "connecting":
    case "verifying":
      return "Conectando à nova máquina";
    case "ready":
      return "Máquina conectada";
    case "failed":
      if (state.stage === "claim") return "Não foi possível parear";
      if (state.stage === "connect") return "Falha ao conectar";
      return "Falha ao verificar a conexão";
  }
}

function descriptionFor(state: SetupState): string {
  switch (state.status) {
    case "claiming":
      return "Resgatando o código de pareamento…";
    case "connecting":
      return state.mode === "tailnet" ? "Entrando na rede…" : "Conectando…";
    case "verifying":
      return "Verificando a conexão…";
    case "ready":
      return `Encontramos ${String(state.info.sessionCount)} conversa(s) nessa máquina.`;
    case "failed":
      if (state.stage === "claim") {
        return "O código pode ter expirado, já ter sido usado, ou a máquina pode estar fora do ar.";
      }
      return "Não foi possível confirmar a conexão. Você pode tentar de novo — o código já foi resgatado, então isso não vai gastar outro.";
  }
}

/**
 * Purely presentational — every field it reads comes in as a prop, nothing
 * here calls `enqueueProfileSetup`/`retryProfileSetup`/etc. directly. That's
 * what makes it testable with no mocks at all, and what lets `App.tsx` be
 * the only place that decides what "Continuar"/"ir para o perfil existente"
 * actually do (switch profile, repaint theme, open a fresh tab — none of
 * which belongs in a dialog component).
 *
 * Blocking but closeable: Esc, a click outside, and "Deixar para depois"
 * all end up calling `onDismiss` — Radix's own default behavior for a
 * `Dialog`, so neither `onEscapeKeyDown` nor `onInteractOutside` is
 * overridden here, and `DialogContent`'s close button is left enabled.
 */
export function ProfileSetupDialog({ state, queuedCount, onContinue, onUseExisting, onRetry, onDismiss }: ProfileSetupDialogProps) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      {state && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{titleFor(state)}</DialogTitle>
          </DialogHeader>

          <DialogBody>
            <DialogDescription>{descriptionFor(state)}</DialogDescription>

            <ProfileSetupStepList state={state} />

            {state.status === "ready" && state.duplicates.length > 0 && (
              <div className="flex flex-col gap-2 border border-border bg-bg-chrome p-3 text-sm">
                <p>
                  Você já tem um perfil pra essa máquina: <strong>{state.duplicates[0].label}</strong>.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => onUseExisting(state.duplicates[0].id)}
                >
                  Ir para o perfil existente
                </Button>
              </div>
            )}
          </DialogBody>

          <DialogFooter className="items-center sm:justify-between">
            {queuedCount > 0 && <span className="text-xs text-muted-foreground">+{queuedCount} na fila</span>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
                Deixar para depois
              </Button>
              {state.status === "failed" && state.stage !== "claim" && (
                <Button type="button" size="sm" onClick={onRetry}>
                  Tentar novamente
                </Button>
              )}
              {state.status === "ready" && (
                <Button type="button" size="sm" onClick={() => onContinue(state.profile.id)}>
                  Continuar para novo perfil
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
