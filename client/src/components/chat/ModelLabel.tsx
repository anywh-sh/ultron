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
  /** Modelo padrão de verdade da conta desse perfil (docs/28), usado quando
   * `model` é `null` — testado direto contra a CLI de cada perfil: os
   * defaults são DIFERENTES entre eles (pessoal veio Sonnet, trabalho veio
   * Opus), por isso não dava pra só fixar um nome aqui sem sondar de
   * verdade. */
  defaultModel: string | null;
}

/**
 * Confirmação visual de que `/model` (docs/26) surtiu efeito — sem isso não
 * tinha nenhum jeito de saber se a troca deu certo além de mandar `/model`
 * de novo pra consultar. Sem borda/fundo de propósito (pedido do usuário) —
 * só texto, entre o seletor de permissão e o uso de contexto.
 */
export function ModelLabel({ model, defaultModel }: ModelLabelProps) {
  const label = model ? MODEL_LABELS[model] : defaultModel;
  if (!label) return null;
  return <span className="shrink-0 text-xs text-muted-foreground">{label}</span>;
}
