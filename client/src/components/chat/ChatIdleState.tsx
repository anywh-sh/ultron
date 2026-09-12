import { IdleScreen } from "@/components/shell/IdleScreen";
import { useDict } from "@/i18n";

/** Shown in place of the log while the tab is a new conversation with no
 * messages yet — avoids the "loading history" skeleton (which makes no
 * sense here, there's no history at all to load) and the blank-screen
 * feeling while the connection to the relay hasn't confirmed yet. */
export function ChatIdleState() {
  const dict = useDict();
  return <IdleScreen heading={dict.common.untitledSession} subtitle={dict.chat.log.idleSubtitle} />;
}
