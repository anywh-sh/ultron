import { getKnownModels, labelForModel } from "@/lib/modelCatalog";
import type { ModelChoice } from "@/lib/relay-types";

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
    if (model === "default" || getKnownModels().includes(model)) return { name: "model", model };
  }

  return null;
}

export interface SlashCommandEntry {
  /** Full text that fills the composer on selection — includes the slash. */
  command: string;
  description: string;
}

/** Curated blurb for the aliases we know about — anything else (a new alias
 * the CLI ships later) falls back to a generic "Usa o X" built from
 * `labelForModel`, so a new model shows up in the menu without a code
 * change. */
const CURATED_DESCRIPTIONS: Record<string, string> = {
  default: "Usa o modelo padrão da CLI",
  opus: "Usa o Opus — mais capaz, mais lento",
  haiku: "Usa o Haiku — mais rápido",
};

function descriptionFor(choice: string): string {
  return CURATED_DESCRIPTIONS[choice] ?? `Usa o ${labelForModel(choice)}`;
}

/** Catalog for the autocomplete menu (SlashCommandMenu) — one entry per
 * combination already ready to send (including each model the CLI reports
 * as available), not just the two command names. Discovering "which models
 * exist" via free typing would be worse UX than already listing all of them
 * ready to go. Computed on every call (not a static list) since the model
 * catalog itself is dynamic (`@/lib/modelCatalog`). */
function getSlashCommandEntries(): SlashCommandEntry[] {
  return [
    { command: "/clear", description: "Limpa o histórico desta conversa" },
    { command: "/model default", description: descriptionFor("default") },
    ...getKnownModels().map((choice) => ({ command: `/model ${choice}`, description: descriptionFor(choice) })),
  ];
}

/** Filters by substring (case-insensitive) against the command's text
 * (without the slash) or its description — covers both "typed the name" and
 * "typed what it does". Empty query returns the whole catalog, in the order
 * declared. */
export function filterSlashCommands(query: string): SlashCommandEntry[] {
  const entries = getSlashCommandEntries();
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (entry) => entry.command.slice(1).toLowerCase().includes(q) || entry.description.toLowerCase().includes(q),
  );
}
