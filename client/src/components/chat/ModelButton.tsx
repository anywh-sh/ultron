import { useRef, useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ModelChoice } from "@/lib/relayClient";
import { cn } from "@/lib/utils";

const MODEL_LABELS: Record<ModelChoice, string> = {
  default: "Padrão",
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
  fable: "Fable",
};

const MODELS: { value: ModelChoice; label: string }[] = [
  { value: "default", label: MODEL_LABELS.default },
  { value: "sonnet", label: MODEL_LABELS.sonnet },
  { value: "opus", label: MODEL_LABELS.opus },
  { value: "haiku", label: MODEL_LABELS.haiku },
  { value: "fable", label: MODEL_LABELS.fable },
];

interface ModelButtonProps {
  model: ModelChoice | null;
  /** Modelo padrão de verdade da conta desse perfil (docs/28), usado como
   * label quando `model` é `null` (nenhuma troca explícita ainda) — os
   * defaults são DIFERENTES entre perfis (pessoal veio Sonnet, trabalho veio
   * Opus), por isso não dá pra só fixar um nome aqui sem sondar de verdade. */
  defaultModel: string | null;
  onChange: (model: ModelChoice) => void;
  /** `true` antes do primeiro `permission_mode_state`/`model_state` chegar
   * (nada pra mostrar ainda) OU depois que a conversa já teve seu primeiro
   * turno: trocar o modelo no meio da conversa exigiria reler todo o
   * histórico pra reconstruir o contexto no modelo novo, então a troca só
   * vale antes do primeiro turno (mesmo raciocínio do `cwdLocked` /
   * `WorkingDirectoryButton`). */
  disabled: boolean;
}

function labelFor(model: ModelChoice | null, defaultModel: string | null): string {
  if (model) return MODEL_LABELS[model];
  return defaultModel ?? "…";
}

/**
 * Label + dropdown na mesma linha do `PermissionModeButton`, ao lado dele —
 * mesmo pill de botão, mesmo `modal={false}` (Radix trava foco/pointer-events
 * no body enquanto um dropdown modal está aberto, e a restauração falha no
 * WKWebView do Tauri no macOS). Antes disso o modelo era só texto
 * (`ModelLabel`); virou dropdown pra não depender de digitar `/model` no
 * composer.
 */
export function ModelButton({ model, defaultModel, onChange, disabled }: ModelButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = labelFor(model, defaultModel);
  const isDisabled = disabled || label === "…";
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      modal={false}
      // Controlado (não só `onOpenChange`) de propósito: passar `disabled` só
      // pro `<button>` filho via `asChild` não bastava — o `Trigger` do Radix
      // lê seu PRÓPRIO prop `disabled` (default `false`, já que a gente só
      // dava `asChild`) pra decidir se ignora pointerdown/keydown, então o
      // menu abria mesmo com o botão cinza/travado em pelo menos uma WebView
      // (mesma classe de quirk que motivou `modal={false}` acima). Barrar a
      // abertura aqui, no estado, funciona não importa qual evento de baixo
      // nível o WebView decidiu disparar num `<button disabled>`.
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
        {MODELS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <Check className={cn("size-3.5", option.value !== model && "opacity-0")} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
