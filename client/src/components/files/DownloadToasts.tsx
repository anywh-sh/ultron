import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { useDownloadNotifications } from "@/hooks/useDownloadNotifications";
import { dismissDownloadNotification, type DownloadNotification } from "@/lib/downloadNotifications";

function toastText(notification: DownloadNotification): string {
  if (notification.fileName) return `Arquivo ${notification.fileName} baixado`;
  const verb = notification.done ? "Baixado" : "Baixando";
  return `${verb} ${String(notification.current)}/${String(notification.total)} arquivos`;
}

/**
 * Bottom-right download progress toasts (journal/41), mirroring how Zed's
 * remote project panel reports a directory download: one line per
 * in-flight/just-finished batch, the count ticking up live. Stays on screen
 * until dismissed via its own close button — no auto-dismiss timer, so a
 * "Baixado X/Y arquivos" toast doesn't disappear before the user notices it.
 * Portaled to `document.body` on the same reasoning as `ContextMenuAnchor`
 * (useContextMenu.tsx) — a session tab's content sits inside
 * `TabGroupLayout`'s `contain: layout paint` wrapper, which would otherwise
 * turn this `fixed` stack's corner anchor into an offset from that wrapper
 * instead of the real viewport.
 */
export function DownloadToasts() {
  const notifications = useDownloadNotifications();
  if (notifications.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className="pointer-events-auto flex max-w-72 items-center gap-2.5 rounded-md border bg-popover px-3.5 py-2.5 text-sm text-popover-foreground shadow-lg"
          title={notification.fileName}
        >
          {notification.done ? (
            <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            // Same "in progress" language as SessionListItem/TabGroupStrip's
            // running-session spinner — a shared visual vocabulary for
            // "something's happening", not a download-specific icon choice.
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <span className="truncate">{toastText(notification)}</span>
          <button
            type="button"
            onClick={() => dismissDownloadNotification(notification.id)}
            aria-label="Dispensar notificação"
            className="ml-auto shrink-0 rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
