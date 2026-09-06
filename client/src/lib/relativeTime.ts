/** "now", "3 min ago", "2h ago", "5d ago" — after a week falls back to the
 * absolute date (`formatAbsoluteTime`), like Claude.ai-style references:
 * relative only makes sense while the order of magnitude is obvious at a
 * glance.
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

/** Full date + time, pt-BR — used in the relative timestamp's tooltip
 * (hover reveals the exact time) and as `formatRelativeTime`'s fallback
 * after a week. */
export function formatAbsoluteTime(epochMs: number): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(epochMs));
}
