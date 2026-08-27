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
 * antes de disparar a notificação com o corpo de fallback — cobre tanto o
 * gerador falhando quanto uma lentidão incomum, sem travar a notificação
 * indefinidamente. */
const NOTIFICATION_SUMMARY_TIMEOUT_MS = 4000;

const FALLBACK_BODY = "Resposta pronta";
const STOPPED_BODY = "Interrompido";
const MAX_BODY_CHARS = 160;

interface PendingNotification {
  timer: ReturnType<typeof setTimeout>;
  profile: Profile;
  sessionTitle: string;
  /** Corpo a usar se o resumo do relay não chegar a tempo — a última
   * mensagem do usuário (mais informativa que um texto genérico), ou
   * `FALLBACK_BODY` se essa mensagem não existir por algum motivo. */
  fallbackBody: string;
  isStillHidden: () => boolean;
}

/** Uma entrada por aba com notificação agendada — chaveado por `tabId`
 * (== sessionId do relay) pra `resolveNotificationSummary` conseguir casar o
 * resumo assíncrono que chega depois com o turno que o originou. */
const pending = new Map<string, PendingNotification>();

function cleanBody(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_BODY_CHARS ? `${collapsed.slice(0, MAX_BODY_CHARS)}…` : collapsed;
}

/** Vai direto pro comando Rust `notify_turn_complete` em vez de
 * `sendNotification` do plugin: no Windows o plugin usa o ícone do
 * PowerShell fora de um build instalado e não repassa o clique no toast pro
 * JS, então o ícone e o clique (foco de janela + troca de aba) são
 * implementados nativamente do lado Rust (ver src-tauri/src/notifications.rs
 * e hooks/useNotificationClick.ts). `sessionId`/`profileId` viajam junto só
 * pra esse roteamento do clique — título e corpo já vêm prontos daqui.
 *
 * Título é só o nome da conversa (sem prefixo de perfil — testado com
 * "[Perfil] resumo" e não ficou bom, o perfil só importa pro roteamento do
 * clique, não precisa ocupar espaço do título); o corpo é o resumo do que
 * o assistente fez ou, se ficou esperando alguma decisão do usuário, o que
 * está pendente — ver o system prompt em notificationSummaryGenerator.ts. */
function fire(tabId: string, profile: Profile, sessionTitle: string, body: string): void {
  if (!inTauri() || !permissionGranted) return;
  void invoke("notify_turn_complete", { title: sessionTitle, body: cleanBody(body), sessionId: tabId, profileId: profile.id });
}

/** Chamado (via `App.tsx`) quando um turno termina fora do foco — agenda a
 * notificação do SO. Turnos interrompidos (`stopped`) notificam na hora, sem
 * resumo pra esperar (não há resposta coerente pra resumir). Turnos
 * concluídos de verdade esperam o resumo assíncrono chegar via
 * `resolveNotificationSummary`, com o timeout acima como rede de segurança e
 * a última mensagem do usuário como corpo alternativo (mais útil que um texto
 * genérico). `isStillHidden` é reconferido no disparo de verdade (aqui só no
 * timeout; `resolveNotificationSummary` reconfere de novo na chegada do
 * resumo) — evita notificar um turno cuja aba o usuário já voltou a olhar
 * enquanto o resumo ainda gerava. */
export function scheduleTurnCompleteNotification(
  tabId: string,
  profile: Profile,
  sessionTitle: string,
  lastUserText: string | null,
  stopped: boolean,
  isStillHidden: () => boolean,
): void {
  if (stopped) {
    fire(tabId, profile, sessionTitle, STOPPED_BODY);
    return;
  }
  const existing = pending.get(tabId);
  if (existing) clearTimeout(existing.timer);
  const fallbackBody = lastUserText ?? FALLBACK_BODY;
  const timer = setTimeout(() => {
    pending.delete(tabId);
    if (isStillHidden()) fire(tabId, profile, sessionTitle, fallbackBody);
  }, NOTIFICATION_SUMMARY_TIMEOUT_MS);
  pending.set(tabId, { timer, profile, sessionTitle, fallbackBody, isStillHidden });
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
  if (entry.isStillHidden()) fire(tabId, entry.profile, entry.sessionTitle, summary ?? entry.fallbackBody);
}
