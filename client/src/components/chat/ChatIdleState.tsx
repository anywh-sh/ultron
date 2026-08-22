import { IdleScreen } from "@/components/shell/IdleScreen";

/** Mostrado no lugar do log enquanto a aba é uma conversa nova sem nenhuma
 * mensagem ainda — evita o skeleton de "carregando histórico" (que não faz
 * sentido aqui, não existe histórico nenhum pra carregar) e a sensação de
 * tela em branco enquanto a conexão com o relay ainda não confirmou. */
export function ChatIdleState() {
  return <IdleScreen heading="Nova conversa" subtitle="Escreva uma mensagem abaixo para começar." />;
}
