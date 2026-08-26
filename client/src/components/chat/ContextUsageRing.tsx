import type { ContextUsage } from "@/lib/relayClient";
import { contextUsageColor, contextUsagePercent } from "@/lib/contextUsage";

interface ContextUsageRingProps {
  usage: ContextUsage | null;
  size?: number;
}

const STROKE_WIDTH = 2.5;

/**
 * Anel de progresso da janela de contexto, na mesma linha do
 * `PermissionModeButton`. `usage` é `null` até o primeiro turno da sessão
 * terminar (ver useRelayClient/sharedSession.ts) — nesse caso o componente
 * some da toolbar em vez de mostrar um "0%" enganoso numa sessão sem
 * histórico ainda. Cor vem de `contextUsageColor` (color-mix sobre variáveis
 * CSS, nunca hex fixo — ver lib/contextUsage.ts).
 */
export function ContextUsageRing({ usage, size = 18 }: ContextUsageRingProps) {
  if (!usage) return null;

  const pct = contextUsagePercent(usage);
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="-rotate-90 shrink-0"
      // Decorativo: quando usado sozinho o nome acessível vem do `aria-label`
      // aqui embaixo, mas o uso real (ContextUsageButton) o envolve num
      // `<button>` que já declara o label — duplicar os dois juntos faria
      // leitor de tela anunciar a mesma informação duas vezes.
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={STROKE_WIDTH} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={contextUsageColor(pct)}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease" }}
      />
    </svg>
  );
}
