import type { ModelChoice } from "@/lib/relay-types";

/** Same curation as the relay (relay/src/sessionStore.ts::ModelChoice, docs/26). */
const MODEL_CHOICES: readonly ModelChoice[] = ["default", "sonnet", "opus", "haiku", "fable"];

export type SlashCommand = { name: "model"; model: ModelChoice } | { name: "clear" };

/**
 * `/model` and `/clear` typed in the composer (docs/26) — recognized here
 * BEFORE becoming a real turn, because neither can be a pure passthrough to
 * `claude -p`: a typed `/model` only applies "to this ephemeral process"
 * (confirmed by testing the binary — the next turn goes back to the old
 * model), and we decided to resolve `/clear` locally on the relay instead of
 * spending a turn asking the CLI to do it (see
 * sharedSession.ts::clearConversation).
 *
 * `null` covers two cases that should fall back to a normal message send:
 * plain text, OR a recognized command with an argument we don't curate
 * (e.g. `/model gpt4`) — in this second case the text passes through as a
 * normal message and the CLI itself responds with its own error, without us
 * needing to duplicate validation/error messages here.
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
  /** Full text that fills the composer on selection — includes the slash. */
  command: string;
  description: string;
}

/** Catalog for the autocomplete menu (SlashCommandMenu) — one entry per
 * combination already ready to send (including each curated model), not
 * just the two command names. Discovering "which models exist" via free
 * typing would be worse UX than already listing all of them ready to go. */
export const SLASH_COMMAND_ENTRIES: SlashCommandEntry[] = [
  { command: "/clear", description: "Limpa o histórico desta conversa" },
  { command: "/model default", description: "Usa o modelo padrão da CLI" },
  { command: "/model sonnet", description: "Usa o Sonnet" },
  { command: "/model opus", description: "Usa o Opus — mais capaz, mais lento" },
  { command: "/model haiku", description: "Usa o Haiku — mais rápido" },
  { command: "/model fable", description: "Usa o Fable" },
];

/** Filters by substring (case-insensitive) against the command's text
 * (without the slash) or its description — covers both "typed the name" and
 * "typed what it does". Empty query returns the whole catalog, in the order
 * declared. */
export function filterSlashCommands(query: string): SlashCommandEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMAND_ENTRIES;
  return SLASH_COMMAND_ENTRIES.filter(
    (entry) => entry.command.slice(1).toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
  );
}
