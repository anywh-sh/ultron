import { useEffect, useState } from "react";
import { formatDurationLong } from "@/lib/utils";
import { pickThinkingWord } from "@/lib/thinkingWords";

interface TurnIndicatorProps {
  /** Epoch ms de quando o turno começou de verdade — vem do relay
   * (`turn_state`, docs/30), não do momento em que este componente montou.
   * Importa pro dispositivo que NÃO mandou a mensagem (ou que conecta no
   * meio de um turno já em andamento): sem isso, o cronômetro contaria a
   * partir de quando ele soube, não do início real, subestimando o tempo já
   * passado. Pra quem mandou, `ChatPanel` já preenche isso otimisticamente
   * (`Date.now()` no clique de enviar), então na prática é sempre "agora"
   * pra essa aba — a diferença só aparece pra quem não iniciou. */
  startedAt: number;
}

/** Indicador de turno em andamento — do momento do envio até a resposta
 * terminar (cobre a latência de rede + o tempo de raciocínio do modelo, que
 * frequentemente não expõe texto de thinking de verdade — ver docs/18).
 * Fica acima do composer, fora do log rolável, sem rail lateral.
 */
export function TurnIndicator({ startedAt }: TurnIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  const [word] = useState(pickThinkingWord);

  useEffect(() => {
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

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
