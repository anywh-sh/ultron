import { IdleScreen } from "@/components/shell/IdleScreen";

/** Shown when there's no open tab (from any profile) — only happens before
 * the user picks an existing session or clicks "new conversation" (which
 * opens a blank tab immediately, without going through here). */
export function EmptyState() {
  return <IdleScreen heading="Escolha uma conversa" subtitle="Selecione uma sessão na barra lateral, ou comece uma nova." />;
}
