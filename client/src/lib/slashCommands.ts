import type { ModelChoice } from "@/lib/relay-types";

/** Mesma curadoria do relay (relay/src/sessionStore.ts::ModelChoice, docs/26). */
const MODEL_CHOICES: readonly ModelChoice[] = ["default", "sonnet", "opus", "haiku", "fable"];

export type SlashCommand = { name: "model"; model: ModelChoice } | { name: "clear" };

/**
 * `/model` e `/clear` digitados no composer (docs/26) — reconhecidos aqui
 * ANTES de virar um turno de verdade, porque nenhum dos dois pode ser um
 * passthrough puro pro `claude -p`: `/model` digitado só vale "pra esse
 * processo efêmero" (confirmado testando o binário — o turno seguinte volta
 * pro modelo antigo), e `/clear` a gente decidiu resolver localmente no
 * relay em vez de gastar um turno pra pedir pro CLI fazer isso (ver
 * sharedSession.ts::clearConversation).
 *
 * `null` cobre dois casos que devem cair no envio normal de mensagem: texto
 * comum, OU um comando reconhecido com argumento que a gente não cura (ex:
 * `/model gpt4`) — nesse segundo caso o texto passa como uma mensagem comum
 * e a própria CLI responde com o erro dela, sem a gente precisar duplicar
 * validação/mensagem de erro aqui.
 */
export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();

  if (/^\/clear$/i.test(trimmed)) return { name: "clear" };

  const modelMatch = /^\/model\s+(\S+)$/i.exec(trimmed);
  if (modelMatch) {
    const model = modelMatch[1].toLowerCase();
    if (MODEL_CHOICES.includes(model as ModelChoice)) return { name: "model", model: model as ModelChoice };
  }

  return null;
}
