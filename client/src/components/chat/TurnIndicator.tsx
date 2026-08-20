/** Indicador de turno em andamento — do momento do envio até a resposta
 * terminar (cobre a latência de rede + o tempo de raciocínio do modelo, que
 * frequentemente não expõe texto de thinking de verdade — ver docs/18).
 * Fica acima do composer, fora do log rolável, sem rail lateral. */
export function TurnIndicator() {
  return (
    <div className="mx-3 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-0.5">
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.3s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.15s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint" />
      </span>
      Pensando…
    </div>
  );
}
