import { useRef, useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModelChoice } from "@/lib/relayClient";
import { getKnownModels, labelForModel } from "@/lib/modelCatalog";
import { cn } from "@/lib/utils";

interface ModelButtonProps {
  model: ModelChoice | null;
  /** This profile's account's actual default model, used as the
   * label when `model` is `null` (no explicit switch yet) — the defaults
   * are DIFFERENT between profiles (personal came up Sonnet, work came up
   * Opus), so we can't just hardcode a name here without really probing it. */
  defaultModel: string | null;
  onChange: (model: ModelChoice) => void;
  /** `true` before the first `permission_mode_state`/`model_state` arrives
   * (nothing to show yet) OR after the conversation already had its first
   * turn: switching the model mid-conversation would require rereading the
   * whole history to rebuild context under the new model, so the switch is
   * only valid before the first turn (same reasoning as `cwdLocked` /
   * `WorkingDirectoryButton`). */
  disabled: boolean;
}

function labelFor(model: ModelChoice | null, defaultModel: string | null): string {
  if (model) return labelForModel(model);
  return defaultModel ?? "…";
}

/**
 * Label + dropdown in the same row as `PermissionModeButton`, next to it —
 * same button pill, same `modal={false}` (Radix traps focus/pointer-events
 * on the body while a modal dropdown is open, and restoration fails on
 * Tauri's WKWebView on macOS). Before this the model was just text
 * (`ModelLabel`); it became a dropdown so it doesn't depend on typing
 * `/model` in the composer.
 */
export function ModelButton({ model, defaultModel, onChange, disabled }: ModelButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = labelFor(model, defaultModel);
  const isDisabled = disabled || label === "…";
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      modal={false}
      // Controlled (not just `onOpenChange`) on purpose: passing `disabled`
      // only to the child `<button>` via `asChild` wasn't enough — Radix's
      // `Trigger` reads its OWN `disabled` prop (default `false`, since we
      // only gave it `asChild`) to decide whether to ignore
      // pointerdown/keydown, so the menu would open even with the button
      // greyed out/locked on at least one WebView (same class of quirk that
      // motivated `modal={false}` above). Blocking the opening here, in
      // state, works no matter which low-level event the WebView decided to
      // fire on a `<button disabled>`.
      open={open}
      onOpenChange={(next) => {
        if (next && isDisabled) return;
        setOpen(next);
        if (!next) triggerRef.current?.blur();
      }}
    >
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        <button
          ref={triggerRef}
          type="button"
          disabled={isDisabled}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {getKnownModels().map((choice) => (
          <DropdownMenuItem key={choice} onSelect={() => onChange(choice)}>
            <Check className={cn("size-3.5", choice !== model && "opacity-0")} />
            {labelForModel(choice)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
