import { IdleScreen } from "@/components/shell/IdleScreen";

/** Shown in place of the log while the tab is a new conversation with no
 * messages yet — avoids the "loading history" skeleton (which makes no
 * sense here, there's no history at all to load) and the blank-screen
 * feeling while the connection to the relay hasn't confirmed yet. */
export function ChatIdleState() {
  return <IdleScreen heading="Nova sessão" subtitle="Escreva uma mensagem abaixo para começar." />;
}
