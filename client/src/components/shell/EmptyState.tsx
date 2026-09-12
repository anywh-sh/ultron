import { IdleScreen } from "@/components/shell/IdleScreen";
import { useDict } from "@/i18n";

/** Shown when there's no open tab (from any profile) — only happens before
 * the user picks an existing session or clicks "new conversation" (which
 * opens a blank tab immediately, without going through here). */
export function EmptyState() {
  const dict = useDict();
  return <IdleScreen heading={dict.shell.idle.heading} subtitle={dict.shell.idle.subtitle} />;
}
