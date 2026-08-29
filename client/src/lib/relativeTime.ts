/** "agora", "há 3 min", "há 2h", "há 5d" — depois de uma semana cai pra data
 * absoluta (`formatAbsoluteTime`), igual referências do tipo Claude.ai:
 * relativo só faz sentido enquanto a ordem de grandeza é óbvia de cabeça.
 */
export function formatRelativeTime(epochMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (diffSeconds < 30) return "agora";
  if (diffSeconds < 60) return "há alguns segundos";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `há ${String(diffMinutes)} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `há ${String(diffHours)}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `há ${String(diffDays)}d`;
  return formatAbsoluteTime(epochMs);
}

/** Data + hora completas, pt-BR — usado no tooltip do timestamp relativo
 * (hover revela a hora exata) e como fallback de `formatRelativeTime` depois
 * de uma semana. */
export function formatAbsoluteTime(epochMs: number): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(epochMs));
}
