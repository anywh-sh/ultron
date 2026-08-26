import { useEffect, useState } from "react";
import { formatDurationLong } from "@/lib/utils";
import { pickThinkingWord } from "@/lib/thinkingWords";

/** Indicador de turno em andamento — do momento do envio até a resposta
 * terminar (cobre a latência de rede + o tempo de raciocínio do modelo, que
 * frequentemente não expõe texto de thinking de verdade — ver docs/18).
 * Fica acima do composer, fora do log rolável, sem rail lateral.
 *
 * O cronômetro é o próprio ciclo de vida do componente: `ChatPanel` só
 * monta isso enquanto `turnInFlight` é `true` (do envio até turn_complete/
 * turn_error), então "desde que montou" já é exatamente "desde que a
 * mensagem foi enviada" — sem precisar de um timestamp vindo de fora. Mesmo
 * ciclo de vida também é o que dá "um verbo por turno": sorteado uma vez no
 * `useState` inicial, não recalculado em cada render.
 */
export function TurnIndicator() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [word] = useState(pickThinkingWord);

  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-3 mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-0.5">
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.3s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.15s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint" />
      </span>
      <span className="animate-text-shimmer font-medium">{word}…</span>
      <span className="font-mono">{formatDurationLong(elapsedSeconds)}</span>
    </div>
  );
}
