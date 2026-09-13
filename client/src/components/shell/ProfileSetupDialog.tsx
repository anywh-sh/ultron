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
import { useDict, type Dictionary } from "@/i18n";
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

function titleFor(state: SetupState, copy: Dictionary["shell"]["profiles"]["setup"]): string {
  switch (state.status) {
    case "claiming":
    case "connecting":
    case "verifying":
      return copy.connectingTitle;
    case "ready":
      return copy.connectedTitle;
    case "failed":
      if (state.stage === "claim") return copy.claimFailedTitle;
      if (state.stage === "connect") return copy.connectFailedTitle;
      return copy.verifyFailedTitle;
  }
}

function descriptionFor(state: SetupState, copy: Dictionary["shell"]["profiles"]["setup"]): string {
  switch (state.status) {
    case "claiming":
      return copy.claiming;
    case "connecting":
      return state.mode === "tailnet" ? copy.joining : copy.dialing;
    case "verifying":
      return copy.verifying;
    case "ready":
      return copy.ready.replace("{count}", String(state.info.sessionCount));
    case "failed":
      return state.stage === "claim" ? copy.claimFailedBody : copy.retryBody;
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
  const dict = useDict();
  const copy = dict.shell.profiles.setup;

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
            <DialogTitle>{titleFor(state, copy)}</DialogTitle>
          </DialogHeader>

          <DialogBody>
            <DialogDescription>{descriptionFor(state, copy)}</DialogDescription>

            <ProfileSetupStepList state={state} />

            {state.status === "ready" && state.duplicates.length > 0 && (
              <div className="flex flex-col gap-2 border border-border bg-bg-chrome p-3 text-sm">
                <p>
                  {copy.duplicate.split("{label}")[0]}
                  <strong>{state.duplicates[0].label}</strong>
                  {copy.duplicate.split("{label}")[1]}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => onUseExisting(state.duplicates[0].id)}
                >
                  {copy.useExisting}
                </Button>
              </div>
            )}
          </DialogBody>

          <DialogFooter className="items-center sm:justify-between">
            {queuedCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {copy.queued.replace("{count}", String(queuedCount))}
              </span>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
                {copy.later}
              </Button>
              {state.status === "failed" && state.stage !== "claim" && (
                <Button type="button" size="sm" onClick={onRetry}>
                  {dict.common.retry}
                </Button>
              )}
              {state.status === "ready" && (
                <Button type="button" size="sm" onClick={() => onContinue(state.profile.id)}>
                  {copy.continueToProfile}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
