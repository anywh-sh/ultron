import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupMode, SetupState } from "@/lib/profileSetup";

type StepKey = "claim" | "connect" | "verify";
type StepStatus = "pending" | "running" | "done" | "failed";

const STEP_LABELS: Record<StepKey, string> = {
  claim: "Resgatando código",
  connect: "Conectando",
  verify: "Verificando",
};

const TAILNET_STEPS: StepKey[] = ["claim", "connect", "verify"];
const STEP_INDEX: Record<StepKey, number> = { claim: 0, connect: 1, verify: 2 };

/** A direct (`host`+`port`) profile has nothing to claim or join — both are
 * synchronous no-ops (`profileSetup.ts`'s `connectStep`) — so the step list
 * for that mode is just the one step that actually does anything. */
function stepsForMode(mode: SetupMode): StepKey[] {
  return mode === "direct" ? ["verify"] : TAILNET_STEPS;
}

function statusFor(step: StepKey, state: SetupState): StepStatus {
  if (state.status === "ready") return "done";
  if (state.mode === "direct") {
    // Only "verify" is ever rendered in this mode — claiming/connecting are
    // folded into the same row since nothing in the UI distinguishes them.
    return state.status === "failed" ? "failed" : "running";
  }
  if (state.status === "failed") {
    const failedIndex = STEP_INDEX[state.stage];
    const stepIndex = STEP_INDEX[step];
    if (stepIndex < failedIndex) return "done";
    return stepIndex === failedIndex ? "failed" : "pending";
  }
  const currentIndex = STEP_INDEX[state.status === "claiming" ? "claim" : state.status === "connecting" ? "connect" : "verify"];
  const stepIndex = STEP_INDEX[step];
  if (stepIndex < currentIndex) return "done";
  return stepIndex === currentIndex ? "running" : "pending";
}

function StepIndicator({ status }: { status: StepStatus }) {
  if (status === "done") return <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />;
  if (status === "failed") return <X className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className={cn("size-2.5 shrink-0 rounded-full", status === "running" ? "animate-pulse bg-primary" : "bg-border")}
    />
  );
}

/** Renders as many rows as `state.mode` actually has steps for — the list
 * itself is derived, not fixed, so a direct-mode profile never shows a
 * "claim" or "connect" row it never meaningfully passes through. */
export function ProfileSetupStepList({ state }: { state: SetupState }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite" aria-label="Progresso da conexão">
      {stepsForMode(state.mode).map((step) => {
        const status = statusFor(step, state);
        return (
          <div key={step} className="flex items-center gap-2.5 text-sm">
            <StepIndicator status={status} />
            <span className={cn(status === "pending" && "text-muted-foreground", status === "failed" && "text-destructive")}>
              {STEP_LABELS[step]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
