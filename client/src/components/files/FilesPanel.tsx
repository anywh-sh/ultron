import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, UploadCloud } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { PaneTabStrip } from "@/components/shell/PaneTabStrip";
import { SessionPanel } from "@/components/shell/SessionPanel";
import { FileTree } from "@/components/files/FileTree";
import { FileViewer } from "@/components/files/FileViewer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { useFileTabs } from "@/hooks/useFileTabs";
import { listFiles, uploadFile } from "@/lib/filesClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { physicalPositionToClientPoint } from "@/lib/dragDropPosition";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

export interface ChangeSignal {
  path: string;
  token: number;
}

/** Live refresh (docs/41 phase 5) — sends the client's full currently
 * visible set (expanded tree dirs + open file tabs) to the relay's `/files`
 * watch endpoint, and turns `dir_changed`/`file_changed` notifications into
 * signals `FileTree`/`FileViewer` react to by invalidating just that one
 * path. A basic fixed-delay reconnect (not the exponential backoff
 * `TerminalView` uses) is enough here — losing this connection only means
 * falling back to manual refresh (reopening the folder/file), not a broken
 * feature. */
function useFilesWatch(profile: Profile, sessionId: string, dirs: string[], files: string[]) {
  const [dirChanged, setDirChanged] = useState<ChangeSignal | null>(null);
  const [fileChanged, setFileChanged] = useState<ChangeSignal | null>(null);
  const tokenRef = useRef(0);
  const dirsFilesRef = useRef({ dirs, files });
  dirsFilesRef.current = { dirs, files };
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    function sendWatchState(ws: WebSocket): void {
      if (ws.readyState !== WebSocket.OPEN) return;
      const { dirs: watchedDirs, files: watchedFiles } = dirsFilesRef.current;
      ws.send(JSON.stringify({ type: "watch", dirs: watchedDirs, files: watchedFiles }));
    }

    // A tailnet connection needs its own fresh, unspent connect token on
    // every new TCP connection (journal/49 D4, journal/62) — a reconnect
    // after `close` is a brand-new one, so this resolves again on every
    // call instead of reusing whatever `connect()` used the first time.
    function connect(): void {
      if (cancelled) return;
      resolveConnection(profile)
        .then(({ host, port, token }) => {
          if (cancelled) return;
          const params = new URLSearchParams({ session: sessionId });
          if (token) params.set("token", token);
          const ws = new WebSocket(`ws://${host}:${String(port)}/files?${params.toString()}`);
          socket = ws;
          sendRef.current = () => sendWatchState(ws);

          ws.addEventListener("open", () => sendWatchState(ws));
          ws.addEventListener("message", (event) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(event.data as string);
            } catch {
              return;
            }
            if (typeof parsed !== "object" || parsed === null) return;
            const type = (parsed as { type?: unknown }).type;
            const path = (parsed as { path?: unknown }).path;
            if (typeof path !== "string") return;
            tokenRef.current += 1;
            if (type === "dir_changed") setDirChanged({ path, token: tokenRef.current });
            else if (type === "file_changed") setFileChanged({ path, token: tokenRef.current });
          });
          ws.addEventListener("close", () => {
            if (socket !== ws || cancelled) return;
            reconnectTimer = window.setTimeout(connect, 2000);
          });
        })
        .catch((error: unknown) => {
          console.error("[ultron] failed to resolve a connection for the files watch:", error);
          if (!cancelled) reconnectTimer = window.setTimeout(connect, 2000);
        });
    }
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [profile, sessionId]);

  useEffect(() => {
    sendRef.current();
  }, [dirs, files]);

  return { dirChanged, fileChanged };
}

interface FilesPanelProps {
  profile: Profile;
  chatSessionId: string;
  maximized: boolean;
  fileTabs: ReturnType<typeof useFileTabs>;
  onToggleMaximized: () => void;
  onClose: () => void;
  /** "Open in terminal" on a folder row — owned by `App.tsx`, the only place
   * with both the terminal tabs and the dock state this needs to touch. */
  onOpenTerminal: (path: string) => void;
}

function fileLabel(path: string): string {
  return path.split("/").pop() || path;
}

function breadcrumbSegments(root: string, path: string): string[] {
  const relative = path.startsWith(root) ? path.slice(root.length) : path;
  return relative.split("/").filter(Boolean);
}

/** Drag for the divider between the tree and the viewer, internal to this
 * pane — separate from `usePanelDrag` (the dock column's own resize handle)
 * because the sign is opposite: this handle sits on the tree's *right*
 * edge, so dragging right should *increase* its width, not decrease it. */
function useTreeWidthDrag(width: number, onChange: (width: number) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      draggingRef.current = true;
      setIsDragging(true);

      const startX = event.clientX;
      const startWidth = width;

      function onMove(moveEvent: PointerEvent): void {
        if (!draggingRef.current) return;
        onChange(startWidth + (moveEvent.clientX - startX));
      }
      function onUp(): void {
        draggingRef.current = false;
        setIsDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, onChange],
  );

  return { isDragging, startDrag };
}

/**
 * Drag-and-drop upload — same native Tauri `onDragDropEvent` as
 * `ChatPanel`'s image attach (delivers the dropped file's real path on
 * disk, read via the `read_dropped_file` Rust command), but the target
 * directory depends on *where* inside the panel the drop lands: a folder
 * row in the tree if the cursor is over one (`data-file-tree-dir`, set by
 * `FileTree`), the session's root otherwise (including a drop on the
 * viewer side). The event is window-global (reaches every mounted panel,
 * ChatPanel included — see the comment there), so every `enter`/`over`/`drop`
 * is first checked against this panel's own `containerRef` via
 * `elementFromPoint`, exactly like `ChatPanel` checks against its own.
 */
function useFilesDrop(profile: Profile, sessionId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const resolveDropTarget = useCallback((clientX: number, clientY: number): { withinPanel: boolean; dir: string | null } => {
    const container = containerRef.current;
    if (!container) return { withinPanel: false, dir: null };
    const target = document.elementFromPoint(clientX, clientY);
    if (!target || !container.contains(target)) return { withinPanel: false, dir: null };
    const folderRow = target.closest<HTMLElement>("[data-file-tree-dir]");
    return { withinPanel: true, dir: folderRow?.dataset.fileTreeDir ?? null };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function uploadDroppedPaths(paths: string[], dir: string | null): Promise<void> {
      for (const path of paths) {
        const name = path.split(/[\\/]/).pop() ?? "arquivo";
        try {
          const buffer = await invoke<ArrayBuffer>("read_dropped_file", { path });
          await uploadFile(profile, sessionId, name, buffer, dir ?? undefined);
        } catch (error) {
          console.error("[ultron] failed to upload dropped file:", path, error);
          window.alert(`Não foi possível enviar "${name}".`);
        }
      }
    }

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setIsDraggingOver(false);
          setDropTargetPath(null);
          return;
        }

        const { x, y } = physicalPositionToClientPoint(event.payload.position);
        const { withinPanel, dir } = resolveDropTarget(x, y);

        if (event.payload.type === "drop") {
          setIsDraggingOver(false);
          setDropTargetPath(null);
          if (withinPanel) void uploadDroppedPaths(event.payload.paths, dir);
          return;
        }

        setIsDraggingOver(withinPanel);
        setDropTargetPath(withinPanel ? dir : null);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [profile, sessionId, resolveDropTarget]);

  return { containerRef, isDraggingOver, dropTargetPath };
}

/**
 * Work dir file panel content (docs/41), plugged into the generic
 * `SessionPanel` shell — tree on the left, tabs + breadcrumb + viewer on the
 * right. Mirrors `TerminalPanel`'s mount lifecycle: only exists while the
 * chat tab is active and the pane is open (decided by the caller, App.tsx).
 */
export function FilesPanel({ profile, chatSessionId, maximized, fileTabs, onToggleMaximized, onClose, onOpenTerminal }: FilesPanelProps) {
  const { open, activePath, expanded, treeWidth, root } = fileTabs.getTabs(chatSessionId);
  // Not persisted — same as the terminal's tab list, this is view state, not
  // worth surviving a restart. Defaults to filtered (decision 4, docs/41).
  const [showHidden, setShowHidden] = useState(false);

  // Learns/confirms the session's real root once per mount — if it drifted
  // from what was persisted, `syncRoot` itself resets everything path-based
  // below (decision 9: only possible before the first turn locks the cwd).
  useEffect(() => {
    let cancelled = false;
    listFiles(profile, chatSessionId)
      .then((result) => {
        if (!cancelled) fileTabs.syncRoot(chatSessionId, result.root);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, chatSessionId]);

  const { isDragging, startDrag } = useTreeWidthDrag(treeWidth, (width) => fileTabs.setTreeWidth(chatSessionId, width));

  const openPaths = useMemo(() => open.map((tab) => tab.path), [open]);
  // The root's children render unconditionally (FileTree) so it's always
  // visible even though it's never itself an entry in `expanded` — the watch
  // needs to cover it too, or changes made directly at the session's cwd
  // (not inside any expanded subfolder) never surface without a full reopen.
  const watchedDirs = useMemo(() => (root ? [root, ...expanded] : expanded), [root, expanded]);
  const { dirChanged, fileChanged } = useFilesWatch(profile, chatSessionId, watchedDirs, openPaths);
  const { containerRef: dropContainerRef, isDraggingOver, dropTargetPath } = useFilesDrop(profile, chatSessionId);

  if (!root) {
    return (
      <SessionPanel
        maximized={maximized}
        onToggleMaximized={onToggleMaximized}
        onClose={onClose}
        headerExtra={<div className="px-2.5 py-1 text-xs text-muted-foreground">Arquivos</div>}
      >
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>
      </SessionPanel>
    );
  }

  return (
    <SessionPanel
      maximized={maximized}
      onToggleMaximized={onToggleMaximized}
      onClose={onClose}
      headerExtra={
        <div className="flex min-w-0 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowHidden((current) => !current)}
                aria-label={showHidden ? "Ocultar arquivos ocultos" : "Mostrar arquivos ocultos"}
                className={cn("ml-1 shrink-0", showHidden && "text-foreground")}
              >
                {showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{showHidden ? "Ocultar arquivos ocultos" : "Mostrar arquivos ocultos"}</TooltipContent>
          </Tooltip>
          <PaneTabStrip
            tabs={open.map((tab) => ({ id: tab.path, label: fileLabel(tab.path), italic: !tab.pinned }))}
            activeId={activePath}
            onSelect={(path) => fileTabs.setActiveFile(chatSessionId, path)}
            onClose={(path) => fileTabs.closeTab(chatSessionId, path)}
          />
        </div>
      }
    >
      <div ref={dropContainerRef} className={cn("relative flex h-full min-h-0", isDraggingOver && "ring-2 ring-inset ring-primary")}>
        {isDraggingOver && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-primary/10 py-1 text-xs text-primary">
            <UploadCloud className="size-3.5" />
            {dropTargetPath ? `Solte para enviar para "${fileLabel(dropTargetPath)}"` : "Solte para enviar para a raiz"}
          </div>
        )}
        <div className="h-full shrink-0 overflow-hidden" style={{ width: treeWidth }}>
          <FileTree
            profile={profile}
            sessionId={chatSessionId}
            root={root}
            expanded={expanded}
            activePath={activePath}
            showHidden={showHidden}
            changedDir={dirChanged}
            onToggleExpand={(path) => fileTabs.toggleExpanded(chatSessionId, path)}
            onOpenPreview={(path) => fileTabs.openPreview(chatSessionId, path)}
            onOpenPinned={(path) => fileTabs.openPinned(chatSessionId, path)}
            onFileDeleted={(path) => fileTabs.closeTab(chatSessionId, path)}
            onFileRenamed={(oldPath, newPath) => fileTabs.renamePath(chatSessionId, oldPath, newPath)}
            onOpenTerminal={onOpenTerminal}
            dropTargetPath={dropTargetPath}
          />
        </div>
        <div
          onPointerDown={startDrag}
          className={cn("w-1 shrink-0 cursor-col-resize border-r border-border-soft hover:bg-border", isDragging && "bg-border")}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {activePath ? (
            <>
              <div className="scrollbar-thin shrink-0 overflow-x-auto border-b border-border-soft px-3 py-1.5 font-mono text-xs text-muted-foreground">
                {breadcrumbSegments(root, activePath).join(" / ")}
              </div>
              <div className="min-h-0 flex-1">
                <FileViewer key={activePath} profile={profile} sessionId={chatSessionId} path={activePath} changedFile={fileChanged} />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Selecione um arquivo</div>
          )}
        </div>
      </div>
    </SessionPanel>
  );
}
