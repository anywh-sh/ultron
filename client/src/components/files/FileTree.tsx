import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, Code2, Download, File, FilePlus, Folder, Pencil, SquareTerminal, Trash2 } from "lucide-react";
import type { ChangeSignal } from "@/components/files/FilesPanel";
import { CreateFileDialog } from "@/components/files/CreateFileDialog";
import { RenameFileDialog } from "@/components/files/RenameFileDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { detectEditors, type DetectedEditor } from "@/lib/editors";
import { buildEditorUrl, type EditorId, type EditorLocality } from "@/lib/editorLinks";
import { createFile, deleteFile, getHostInfo, listFiles, renameFile, type FileEntry } from "@/lib/filesClient";
import { downloadFile } from "@/lib/fileDownload";
import { isIOS } from "@/lib/platform";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

type DirState = FileEntry[] | "loading" | "error";

interface FileTreeProps {
  profile: Profile;
  sessionId: string;
  root: string;
  expanded: string[];
  activePath: string | null;
  showHidden: boolean;
  /** Watch (docs/41 phase 5) reported a change in this directory — the
   * folder's cache entry is dropped so the "load whatever's visible but
   * missing" effect below picks it back up. */
  changedDir: ChangeSignal | null;
  onToggleExpand: (path: string) => void;
  onOpenPreview: (path: string) => void;
  onOpenPinned: (path: string) => void;
  /** A tab open on the deleted/renamed path needs to close (delete) or
   * follow the new path (rename) — the tree's own listing self-corrects via
   * the watch (docs/41 phase 5) without any of this, but tab state lives in
   * `useFileTabs`, one level up in `FilesPanel`. */
  onFileDeleted: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  /** Opens (or reuses, per `useSessionDock.openPane`) the terminal pane with
   * a fresh tab rooted at this folder — wired all the way up to `App.tsx`,
   * the only place that has both the terminal tabs and the dock state. */
  onOpenTerminal: (path: string) => void;
  /** Folder row a drag-and-drop upload is currently hovering, or `null` for
   * "none"/"root" — drives the highlight below and, via each row's
   * `data-file-tree-dir`, is how `FilesPanel` resolves which folder a drop
   * lands in (`elementFromPoint` + `closest`). Owned by `FilesPanel` since
   * the Tauri drag events it reads are window-global, not scoped to this
   * component. */
  dropTargetPath: string | null;
}

const INDENT_PX = 14;

interface EditorOpenMenuItemsProps {
  editors: DetectedEditor[];
  locality: EditorLocality;
  path: string;
  /** e.g. `(label) => \`Abrir no ${label}\`` for a file/folder row, or
   * `\`Abrir projeto no ${label}\`` for the panel-level root action. */
  itemLabel: (editorLabel: string) => string;
  /** Submenu trigger label used only when more than one editor was
   * detected — e.g. "Abrir com" / "Abrir projeto com". */
  subTriggerLabel: string;
  onSelected: () => void;
}

/**
 * "Open in editor" (journal/60) — hidden entirely when there's no declared
 * locality (both `ULTRON_EDITOR_LOCAL`/`ULTRON_EDITOR_SSH` unset
 * relay-side), no detected editor, or on iOS (no deep link handler exists
 * there). One editor renders a plain item; more than one nests under an
 * "Abrir com" submenu, mirroring the file/folder row's existing pattern of
 * plain item vs. nested choice.
 */
function EditorOpenMenuItems({ editors, locality, path, itemLabel, subTriggerLabel, onSelected }: EditorOpenMenuItemsProps) {
  if (isIOS() || !locality || editors.length === 0) return null;

  function openInEditor(editorId: EditorId): void {
    onSelected();
    const url = buildEditorUrl(editorId, locality, { path });
    if (url) void openUrl(url);
  }

  if (editors.length === 1) {
    const editor = editors[0];
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            openInEditor(editor.id);
          }}
        >
          <Code2 />
          {itemLabel(editor.label)}
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Code2 />
          {subTriggerLabel}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            {editors.map((editor) => (
              <DropdownMenuItem
                key={editor.id}
                onSelect={(event) => {
                  event.preventDefault();
                  openInEditor(editor.id);
                }}
              >
                {editor.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </>
  );
}

/**
 * Lazy tree — only ever lists one folder at a time (docs/41: a recursive
 * scan doesn't scale once `node_modules` is in the picture), caching each
 * expanded folder's listing locally. `root`/`showHidden` changing means the
 * whole cache is stale (a different cwd, or dotfiles toggling visibility),
 * so both reset it; an already-cached or in-flight folder is never
 * refetched (`inFlightRef` guards against StrictMode's dev double-effect and
 * against re-running the "load whatever's expanded but missing" effect on
 * every state update).
 */
export function FileTree({
  profile,
  sessionId,
  root,
  expanded,
  activePath,
  showHidden,
  changedDir,
  onToggleExpand,
  onOpenPreview,
  onOpenPinned,
  onFileDeleted,
  onFileRenamed,
  onOpenTerminal,
  dropTargetPath,
}: FileTreeProps) {
  const [nodesByDir, setNodesByDir] = useState<Record<string, DirState>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const panelMenu = useContextMenu();
  const [createOpen, setCreateOpen] = useState(false);
  const [editorLocality, setEditorLocality] = useState<EditorLocality>(null);
  const [detectedEditors, setDetectedEditors] = useState<DetectedEditor[]>([]);

  // "Open in editor" (journal/60): locality comes from the relay (declared,
  // never inferred — see editorHostInfo.ts), the editor list from a local
  // OS-level scheme detection (editors.rs) — independent lookups, so
  // neither needs to wait on the other before hiding/showing the feature.
  useEffect(() => {
    let cancelled = false;
    getHostInfo(profile)
      .then((info) => {
        if (!cancelled) setEditorLocality(info.editor);
      })
      .catch(() => {});
    detectEditors().then((editors) => {
      if (!cancelled) setDetectedEditors(editors);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  async function handleCreateFile(name: string): Promise<void> {
    try {
      const result = await createFile(profile, sessionId, name);
      setCreateOpen(false);
      onOpenPinned(result.path);
    } catch (error) {
      console.error("[ultron] failed to create file:", error);
      window.alert("Não foi possível criar o arquivo.");
    }
  }

  const loadDir = useCallback(
    (dir: string) => {
      if (inFlightRef.current.has(dir)) return;
      inFlightRef.current.add(dir);
      setNodesByDir((prev) => ({ ...prev, [dir]: "loading" }));
      listFiles(profile, sessionId, dir === root ? undefined : dir, showHidden)
        .then((result) => setNodesByDir((prev) => ({ ...prev, [dir]: result.entries })))
        .catch(() => setNodesByDir((prev) => ({ ...prev, [dir]: "error" })))
        .finally(() => inFlightRef.current.delete(dir));
    },
    [profile, sessionId, root, showHidden],
  );

  useEffect(() => {
    setNodesByDir({});
    inFlightRef.current.clear();
    loadDir(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, showHidden]);

  // The root's own children render unconditionally (see the JSX below), so
  // it's always "visible" for this purpose even though it's never itself an
  // entry in `expanded`.
  useEffect(() => {
    for (const dir of [root, ...expanded]) {
      if (!(dir in nodesByDir)) loadDir(dir);
    }
  }, [root, expanded, nodesByDir, loadDir]);

  // Watch (docs/41 phase 5) — drop the changed folder's cache entry so the
  // effect above (which only fetches what's MISSING from the cache) picks it
  // back up. A no-op for a directory that isn't currently visible: deleting
  // an absent key changes nothing, and the effect above only reloads
  // `[root, ...expanded]`.
  useEffect(() => {
    if (!changedDir) return;
    setNodesByDir((prev) => {
      if (!(changedDir.path in prev)) return prev;
      const next = { ...prev };
      delete next[changedDir.path];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedDir]);

  return (
    <div className="scrollbar-thin h-full overflow-auto py-1 text-xs" onContextMenu={panelMenu.onContextMenu}>
      <FileTreeChildren
        dir={root}
        depth={0}
        profile={profile}
        sessionId={sessionId}
        nodesByDir={nodesByDir}
        expanded={expanded}
        activePath={activePath}
        onToggleExpand={onToggleExpand}
        onOpenPreview={onOpenPreview}
        onOpenPinned={onOpenPinned}
        onFileDeleted={onFileDeleted}
        onFileRenamed={onFileRenamed}
        onOpenTerminal={onOpenTerminal}
        editorLocality={editorLocality}
        detectedEditors={detectedEditors}
        dropTargetPath={dropTargetPath}
      />
      <DropdownMenu open={panelMenu.open} onOpenChange={panelMenu.setOpen}>
        <DropdownMenuTrigger asChild>
          <span className="pointer-events-none fixed" style={{ left: panelMenu.position.x, top: panelMenu.position.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              panelMenu.setOpen(false);
              setCreateOpen(true);
            }}
          >
            <FilePlus />
            Novo arquivo
          </DropdownMenuItem>
          <EditorOpenMenuItems
            editors={detectedEditors}
            locality={editorLocality}
            path={root}
            itemLabel={(label) => `Abrir projeto no ${label}`}
            subTriggerLabel="Abrir projeto com"
            onSelected={() => panelMenu.setOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateFileDialog open={createOpen} onOpenChange={setCreateOpen} onSave={(name) => void handleCreateFile(name)} />
    </div>
  );
}

interface SharedTreeProps {
  depth: number;
  profile: Profile;
  sessionId: string;
  nodesByDir: Record<string, DirState>;
  expanded: string[];
  activePath: string | null;
  onToggleExpand: (path: string) => void;
  onOpenPreview: (path: string) => void;
  onOpenPinned: (path: string) => void;
  onFileDeleted: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onOpenTerminal: (path: string) => void;
  editorLocality: EditorLocality;
  detectedEditors: DetectedEditor[];
  dropTargetPath: string | null;
}

interface ChildrenProps extends SharedTreeProps {
  dir: string;
}

function FileTreeChildren({
  dir,
  depth,
  profile,
  sessionId,
  nodesByDir,
  expanded,
  activePath,
  onToggleExpand,
  onOpenPreview,
  onOpenPinned,
  onFileDeleted,
  onFileRenamed,
  onOpenTerminal,
  editorLocality,
  detectedEditors,
  dropTargetPath,
}: ChildrenProps) {
  const nodes = nodesByDir[dir];
  const indent = `${depth * INDENT_PX + 8}px`;

  if (nodes === undefined || nodes === "loading") {
    return (
      <div style={{ paddingLeft: indent }} className="py-1 text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (nodes === "error") {
    return (
      <div style={{ paddingLeft: indent }} className="py-1 text-destructive">
        Não foi possível listar essa pasta.
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div style={{ paddingLeft: indent }} className="py-1 text-muted-foreground italic">
        Pasta vazia
      </div>
    );
  }

  return (
    <>
      {nodes.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={depth}
          profile={profile}
          sessionId={sessionId}
          nodesByDir={nodesByDir}
          expanded={expanded}
          activePath={activePath}
          onToggleExpand={onToggleExpand}
          onOpenPreview={onOpenPreview}
          onOpenPinned={onOpenPinned}
          onFileDeleted={onFileDeleted}
          onFileRenamed={onFileRenamed}
          onOpenTerminal={onOpenTerminal}
          editorLocality={editorLocality}
          detectedEditors={detectedEditors}
          dropTargetPath={dropTargetPath}
        />
      ))}
    </>
  );
}

interface NodeProps extends SharedTreeProps {
  entry: FileEntry;
}

function FileTreeNode({
  entry,
  depth,
  profile,
  sessionId,
  nodesByDir,
  expanded,
  activePath,
  onToggleExpand,
  onOpenPreview,
  onOpenPinned,
  onFileDeleted,
  onFileRenamed,
  onOpenTerminal,
  editorLocality,
  detectedEditors,
  dropTargetPath,
}: NodeProps) {
  const isDir = entry.kind === "dir";
  const isExpanded = isDir && expanded.includes(entry.path);
  const isActive = entry.path === activePath;
  // File and directory rows show different items below (decision 6, docs/41
  // for the file ones) — both get a menu now, "open in terminal" only makes
  // sense for a folder.
  const menu = useContextMenu();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  async function handleDownload(): Promise<void> {
    try {
      await downloadFile(profile, sessionId, entry.path, entry.name, entry.mtimeMs);
    } catch (error) {
      console.error("[ultron] failed to download file:", error);
      window.alert("Não foi possível baixar o arquivo.");
    }
  }

  async function handleRename(newName: string): Promise<void> {
    try {
      const result = await renameFile(profile, sessionId, entry.path, newName);
      onFileRenamed(entry.path, result.path);
      setRenameOpen(false);
    } catch (error) {
      console.error("[ultron] failed to rename file:", error);
      window.alert("Não foi possível renomear o arquivo.");
    }
  }

  async function handleDelete(): Promise<void> {
    try {
      await deleteFile(profile, sessionId, entry.path);
      onFileDeleted(entry.path);
    } catch (error) {
      console.error("[ultron] failed to delete file:", error);
      window.alert("Não foi possível excluir o arquivo.");
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        data-file-tree-dir={isDir ? entry.path : undefined}
        onClick={() => (isDir ? onToggleExpand(entry.path) : onOpenPreview(entry.path))}
        onDoubleClick={() => !isDir && onOpenPinned(entry.path)}
        onContextMenu={menu.onContextMenu}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (isDir) onToggleExpand(entry.path);
          else onOpenPreview(entry.path);
        }}
        style={{ paddingLeft: `${depth * INDENT_PX + 8}px` }}
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded py-1 pr-2 hover:bg-border",
          isActive ? "bg-bg-elevated text-foreground" : "text-muted-foreground",
          isDir && dropTargetPath === entry.path && "bg-primary/15 text-foreground ring-1 ring-inset ring-primary",
        )}
      >
        {isDir ? (
          isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        {isDir ? <Folder className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
        <span className="truncate">{entry.name}</span>
        {!isDir && (
          <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
            <DropdownMenuTrigger asChild>
              <span className="pointer-events-none fixed" style={{ left: menu.position.x, top: menu.position.y }} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  menu.setOpen(false);
                  onOpenPinned(entry.path);
                }}
              >
                Abrir em nova aba
              </DropdownMenuItem>
              <EditorOpenMenuItems
                editors={detectedEditors}
                locality={editorLocality}
                path={entry.path}
                itemLabel={(label) => `Abrir no ${label}`}
                subTriggerLabel="Abrir com"
                onSelected={() => menu.setOpen(false)}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  menu.setOpen(false);
                  void handleDownload();
                }}
              >
                <Download />
                Baixar
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  menu.setOpen(false);
                  setRenameOpen(true);
                }}
              >
                <Pencil />
                Renomear
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  menu.setOpen(false);
                  setDeleteConfirmOpen(true);
                }}
              >
                <Trash2 />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isDir && (
          <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
            <DropdownMenuTrigger asChild>
              <span className="pointer-events-none fixed" style={{ left: menu.position.x, top: menu.position.y }} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  menu.setOpen(false);
                  onOpenTerminal(entry.path);
                }}
              >
                <SquareTerminal />
                Abrir no terminal
              </DropdownMenuItem>
              <EditorOpenMenuItems
                editors={detectedEditors}
                locality={editorLocality}
                path={entry.path}
                itemLabel={(label) => `Abrir no ${label}`}
                subTriggerLabel="Abrir com"
                onSelected={() => menu.setOpen(false)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {!isDir && (
        <>
          <RenameFileDialog open={renameOpen} onOpenChange={setRenameOpen} initialName={entry.name} onSave={(name) => void handleRename(name)} />
          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir arquivo</AlertDialogTitle>
                <AlertDialogDescription>Excluir "{entry.name}"? Essa ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleDelete()}>Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {isDir && isExpanded && (
        <FileTreeChildren
          dir={entry.path}
          depth={depth + 1}
          profile={profile}
          sessionId={sessionId}
          nodesByDir={nodesByDir}
          expanded={expanded}
          activePath={activePath}
          onToggleExpand={onToggleExpand}
          onOpenPreview={onOpenPreview}
          onOpenPinned={onOpenPinned}
          onFileDeleted={onFileDeleted}
          onFileRenamed={onFileRenamed}
          onOpenTerminal={onOpenTerminal}
          editorLocality={editorLocality}
          detectedEditors={detectedEditors}
          dropTargetPath={dropTargetPath}
        />
      )}
    </div>
  );
}
