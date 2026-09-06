import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { inTauri } from "@/lib/tauri";
import type { Profile } from "@/lib/profiles";

let permissionGranted: boolean | null = null;

/** Call once at app startup — asks for the OS notification permission if it
 * hasn't been decided yet. Result stays cached for the rest of the app's
 * session; if the user denies it, the functions below become silent no-ops. */
export async function ensureNotificationPermission(): Promise<void> {
  if (!inTauri()) return;
  if (await isPermissionGranted()) {
    permissionGranted = true;
    return;
  }
  permissionGranted = (await requestPermission()) === "granted";
}

/** Maximum time waiting for the AI-generated summary (relay,
 * `notificationSummaryGenerator.ts`) before firing the notification with the
 * fallback body — covers both the generator failing and unusual slowness,
 * without stalling the notification indefinitely. */
const NOTIFICATION_SUMMARY_TIMEOUT_MS = 4000;

const FALLBACK_BODY = "Resposta pronta";
const STOPPED_BODY = "Interrompido";
const MAX_BODY_CHARS = 160;

interface PendingNotification {
  timer: ReturnType<typeof setTimeout>;
  profile: Profile;
  sessionTitle: string;
  /** Body to use if the relay's summary doesn't arrive in time — the last
   * user message (more informative than generic text), or `FALLBACK_BODY`
   * if that message doesn't exist for some reason. */
  fallbackBody: string;
  isStillHidden: () => boolean;
}

/** One entry per tab with a scheduled notification — keyed by `tabId`
 * (== the relay's sessionId) so `resolveNotificationSummary` can match the
 * async summary that arrives later with the turn that triggered it. */
const pending = new Map<string, PendingNotification>();

function cleanBody(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_BODY_CHARS ? `${collapsed.slice(0, MAX_BODY_CHARS)}…` : collapsed;
}

/** Goes straight to the Rust `notify_turn_complete` command instead of the
 * plugin's `sendNotification`: on Windows the plugin uses PowerShell's icon
 * outside of an installed build and doesn't forward the toast click to JS,
 * so the icon and the click (window focus + tab switch) are implemented
 * natively on the Rust side (see src-tauri/src/notifications.rs and
 * hooks/useNotificationClick.ts). `sessionId`/`profileId` travel along just
 * for that click routing — title and body already arrive ready from here.
 *
 * Title is just the conversation's name (no profile prefix — tested with
 * "[Profile] summary" and it didn't look good, the profile only matters for
 * click routing, doesn't need to take up space in the title); the body is
 * the summary of what the assistant did or, if it ended up waiting on some
 * user decision, what's pending — see the system prompt in
 * notificationSummaryGenerator.ts. */
function fire(tabId: string, profile: Profile, sessionTitle: string, body: string): void {
  if (!inTauri() || !permissionGranted) return;
  void invoke("notify_turn_complete", { title: sessionTitle, body: cleanBody(body), sessionId: tabId, profileId: profile.id });
}

/** Called (via `App.tsx`) when a turn ends out of focus — schedules the OS
 * notification. Interrupted turns (`stopped`) notify right away, with no
 * summary to wait for (there's no coherent response to summarize). Genuinely
 * completed turns wait for the async summary to arrive via
 * `resolveNotificationSummary`, with the timeout above as a safety net and
 * the last user message as an alternative body (more useful than generic
 * text). `isStillHidden` is rechecked at the actual firing moment (here only
 * on timeout; `resolveNotificationSummary` rechecks again when the summary
 * arrives) — avoids notifying about a turn whose tab the user has already
 * gone back to looking at while the summary was still generating. */
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

/** Called (via `App.tsx`) when that turn's `notification_summary` arrives
 * from the relay. With no pending entry for that `tabId` — a turn that
 * already fired the timeout fallback, was `stopped`, or the tab never lost
 * focus to begin with — it's a silent no-op. */
export function resolveNotificationSummary(tabId: string, summary: string | null): void {
  const entry = pending.get(tabId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(tabId);
  if (entry.isStillHidden()) fire(tabId, entry.profile, entry.sessionTitle, summary ?? entry.fallbackBody);
}
