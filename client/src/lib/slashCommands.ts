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

export interface SlashCommandEntry {
  /** Texto completo que preenche o composer ao selecionar — inclui a barra. */
  command: string;
  description: string;
}

/** Catálogo pro menu de autocompletar (SlashCommandMenu) — uma entrada por
 * combinação já pronta pra enviar (inclusive cada modelo curado), não só
 * pelos dois nomes de comando. Descobrir "quais modelos existem" via
 * digitação livre seria pior UX do que já listar todos prontos. */
export const SLASH_COMMAND_ENTRIES: SlashCommandEntry[] = [
  { command: "/clear", description: "Limpa o histórico desta conversa" },
  { command: "/model default", description: "Usa o modelo padrão da CLI" },
  { command: "/model sonnet", description: "Usa o Sonnet" },
  { command: "/model opus", description: "Usa o Opus — mais capaz, mais lento" },
  { command: "/model haiku", description: "Usa o Haiku — mais rápido" },
  { command: "/model fable", description: "Usa o Fable" },
];

/** Filtra por substring (case-insensitive) contra o texto do comando (sem a
 * barra) ou a descrição — cobre tanto "digitei o nome" quanto "digitei o que
 * ele faz". Query vazia devolve o catálogo inteiro, na ordem declarada. */
export function filterSlashCommands(query: string): SlashCommandEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMAND_ENTRIES;
  return SLASH_COMMAND_ENTRIES.filter(
    (entry) => entry.command.slice(1).toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
  );
}
