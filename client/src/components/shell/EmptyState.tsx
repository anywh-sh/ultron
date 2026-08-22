import { IdleScreen } from "@/components/shell/IdleScreen";

/** Mostrado quando o perfil ativo não tem nenhuma aba aberta — só acontece
 * antes do usuário escolher uma sessão existente ou clicar em "nova
 * conversa" (que abre uma aba em branco na hora, sem passar por aqui). */
export function EmptyState() {
  return <IdleScreen heading="Escolha uma conversa" subtitle="Selecione uma sessão na barra lateral, ou comece uma nova." />;
}
