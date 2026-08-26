import type { ContextUsage } from "@/lib/relayClient";

// Limiares emprestados da convenção oficial do statusline do Claude Code
// (verde <70%, amarelo 70–89%, vermelho >=90% — code.claude.com/docs/en/statusline)
// mas usados aqui como pontos de transição contínua (color-mix), não bandas
// sólidas — ver ContextUsageRing.
const WARN_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

export function contextUsagePercent(usage: ContextUsage): number {
  if (usage.contextWindowSize <= 0) return 0;
  return Math.min(100, Math.max(0, (usage.usedTokens / usage.contextWindowSize) * 100));
}

/**
 * Cor do anel/barra pra uma % de uso, sempre derivada de variáveis CSS via
 * `color-mix()` — nunca um hex fixo. 0–70%: `--primary` -> `--context-ring-warn`.
 * 70–100%: `--context-ring-warn` -> `--destructive`. Pedido explícito: se
 * `--primary` mudar no futuro, o início do gradiente muda sozinho, sem tocar
 * aqui (ver index.css pro comentário do token `--context-ring-warn`).
 */
export function contextUsageColor(pct: number): string {
  if (pct <= WARN_THRESHOLD) {
    const t = pct / WARN_THRESHOLD;
    return `color-mix(in oklch, var(--context-ring-warn) ${String(t * 100)}%, var(--primary))`;
  }
  const t = Math.min((pct - WARN_THRESHOLD) / (CRITICAL_THRESHOLD - WARN_THRESHOLD), 1);
  return `color-mix(in oklch, var(--destructive) ${String(t * 100)}%, var(--context-ring-warn))`;
}

/** Formata contagem de tokens de forma compacta pro popover (ex: 163_000 ->
 * "163k", 1_000_000 -> "1M"). Só usado em exibição — os números crus vêm
 * direto de `ContextUsage`. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${String(Math.round(n / 1000))}k`;
  }
  return String(Math.round(n));
}
