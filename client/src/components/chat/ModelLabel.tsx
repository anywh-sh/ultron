import type { ModelChoice } from "@/lib/relayClient";

const MODEL_LABELS: Record<ModelChoice, string> = {
  default: "Padrão",
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
  fable: "Fable",
};

interface ModelLabelProps {
  model: ModelChoice | null;
}

/**
 * Confirmação visual de que `/model` (docs/26) surtiu efeito — sem isso não
 * tinha nenhum jeito de saber se a troca deu certo além de mandar `/model`
 * de novo pra consultar. `null` cobre tanto a sessão que nunca rodou
 * `/model` quanto a janela breve antes do primeiro `model_state` — nos dois
 * casos não tem nada confirmado ainda pra mostrar, então não renderiza nada
 * (mesmo padrão do `permissionMode`/`contextUsage` nulos por perto). Sem
 * borda/fundo de propósito (pedido do usuário) — só texto, entre o seletor
 * de permissão e o uso de contexto.
 */
export function ModelLabel({ model }: ModelLabelProps) {
  if (!model) return null;
  return <span className="shrink-0 text-xs text-muted-foreground">{MODEL_LABELS[model]}</span>;
}
