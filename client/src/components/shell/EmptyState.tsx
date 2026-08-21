/** Mostrado quando o perfil ativo não tem nenhuma aba aberta — só acontece
 * antes do usuário escolher uma sessão existente ou clicar em "nova
 * conversa" (que abre uma aba em branco na hora, sem passar por aqui). */
export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="animate-cursor-blink font-mono text-3xl text-text-faint">▍</span>
      <h2 className="text-lg font-medium text-foreground">Escolha uma conversa</h2>
      <p className="max-w-xs text-sm text-muted-foreground">Selecione uma sessão na barra lateral, ou comece uma nova.</p>
    </div>
  );
}
