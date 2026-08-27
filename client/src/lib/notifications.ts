import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { inTauri } from "@/lib/tauri";
import type { Profile } from "@/lib/profiles";

let permissionGranted: boolean | null = null;

/** Chamar uma vez no início do app — pede a permissão de notificação do SO
 * se ainda não foi decidida. Resultado fica em cache pro resto da sessão do
 * app; se o usuário negar, as funções abaixo viram no-op silencioso. */
export async function ensureNotificationPermission(): Promise<void> {
  if (!inTauri()) return;
  if (await isPermissionGranted()) {
    permissionGranted = true;
    return;
  }
  permissionGranted = (await requestPermission()) === "granted";
}

/** Tempo máximo esperando o resumo gerado por IA (relay, `notificationSummaryGenerator.ts`)
 * antes de disparar a notificação com o headline genérico — cobre tanto o
 * gerador falhando quanto uma lentidão incomum, sem travar a notificação
 * indefinidamente. */
const NOTIFICATION_SUMMARY_TIMEOUT_MS = 4000;

const FALLBACK_HEADLINE = "Resposta pronta";
const STOPPED_HEADLINE = "Interrompido";
const MAX_BODY_CHARS = 120;

interface PendingNotification {
  timer: ReturnType<typeof setTimeout>;
  profile: Profile;
  sessionTitle: string;
  lastUserText: string | null;
  isStillHidden: () => boolean;
}

/** Uma entrada por aba com notificação agendada — chaveado por `tabId`
 * (== sessionId do relay) pra `resolveNotificationSummary` conseguir casar o
 * resumo assíncrono que chega depois com o turno que o originou. */
const pending = new Map<string, PendingNotification>();

function cleanBody(text: string | null, fallback: string): string {
  if (!text) return fallback;
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_BODY_CHARS ? `${collapsed.slice(0, MAX_BODY_CHARS)}…` : collapsed;
}

/** Vai direto pro comando Rust `notify_turn_complete` em vez de
 * `sendNotification` do plugin: no Windows o plugin usa o ícone do
 * PowerShell fora de um build instalado e não repassa o clique no toast pro
 * JS, então o ícone é implementado nativamente do lado Rust (ver
 * src-tauri/src/notifications.rs). */
function fire(profile: Profile, sessionTitle: string, lastUserText: string | null, headline: string): void {
  if (!inTauri() || !permissionGranted) return;
  const title = `[${profile.label}] ${headline}`;
  const body = cleanBody(lastUserText, sessionTitle);
  void invoke("notify_turn_complete", { title, body });
}

/** Chamado (via `App.tsx`) quando um turno termina fora do foco — agenda a
 * notificação do SO. Turnos interrompidos (`stopped`) notificam na hora, sem
 * resumo pra esperar (não há resposta coerente pra resumir). Turnos
 * concluídos de verdade esperam o resumo assíncrono chegar via
 * `resolveNotificationSummary`, com o timeout acima como rede de segurança.
 * `isStillHidden` é reconferido no disparo de verdade (aqui só no timeout;
 * `resolveNotificationSummary` reconfere de novo na chegada do resumo) —
 * evita notificar um turno cuja aba o usuário já voltou a olhar enquanto o
 * resumo ainda gerava. */
export function scheduleTurnCompleteNotification(
  tabId: string,
  profile: Profile,
  sessionTitle: string,
  lastUserText: string | null,
  stopped: boolean,
  isStillHidden: () => boolean,
): void {
  if (stopped) {
    fire(profile, sessionTitle, lastUserText, STOPPED_HEADLINE);
    return;
  }
  const existing = pending.get(tabId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(tabId);
    if (isStillHidden()) fire(profile, sessionTitle, lastUserText, FALLBACK_HEADLINE);
  }, NOTIFICATION_SUMMARY_TIMEOUT_MS);
  pending.set(tabId, { timer, profile, sessionTitle, lastUserText, isStillHidden });
}

/** Chamado (via `App.tsx`) quando o `notification_summary` daquele turno
 * chega do relay. Sem entrada pendente pra esse `tabId` — turno que já
 * disparou o fallback do timeout, foi `stopped`, ou a aba nunca saiu de
 * foco pra começo de conversa — é no-op silencioso. */
export function resolveNotificationSummary(tabId: string, summary: string | null): void {
  const entry = pending.get(tabId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(tabId);
  if (entry.isStillHidden()) fire(entry.profile, entry.sessionTitle, entry.lastUserText, summary ?? FALLBACK_HEADLINE);
}
