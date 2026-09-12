import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listDirectories, type FsEntry } from "@/lib/fsBrowse";
import type { Profile } from "@/lib/profiles";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  /** Folder from which the breadcrumb starts when the modal opens — the
   * session's current cwd (which is already "the app's default" when the
   * user never chose anything, resolved by the relay — see relay/src/paths.ts). */
  initialPath: string;
  /** If the session locked between the modal being opened and now (race
   * between two devices), closes itself — see effect below. */
  locked: boolean;
  onSelect: (path: string) => void;
  /** See comment on `WorkingDirectoryButtonProps.onFocusComposer` — same
   * reason, same fix, this time on the `Dialog`'s `onCloseAutoFocus`
   * (which by default would return focus to the trigger that opened the modal). */
  onFocusComposer: () => void;
}

interface Crumb {
  label: string;
  path: string;
}

/** `/home/user/mode/widgets` -> home > user > mode > widgets, each with the path
 * accumulated up to that point. Root becomes a static "/" crumb. */
function breadcrumbsFor(path: string): Crumb[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "/", path: "/" }];
  let acc = "";
  return segments.map((label) => {
    acc += `/${label}`;
    return { label, path: acc };
  });
}

function parentOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Working directory picker modal — path field + navigable breadcrumb +
 * subfolder listing (never files) via `GET /fs/list` on the relay (the
 * machine where the agent runs, not the client device). Modeled on the
 * controlled `Dialog` from `EditLinkDialog.tsx`; unlike that one, this one
 * doesn't live inside the Composer's `<form>` (it's rendered from
 * `WorkingDirectoryButton`, a sibling of the Composer in `ChatPanel`), so
 * the `stopPropagation` care from there doesn't apply here.
 */
export function FolderPickerDialog({
  open,
  onOpenChange,
  profile,
  initialPath,
  locked,
  onSelect,
  onFocusComposer,
}: FolderPickerDialogProps) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  async function navigate(path?: string): Promise<boolean> {
    setLoading(true);
    try {
      const result = await listDirectories(profile, path);
      setBrowsePath(result.path);
      setPathInput(result.path);
      setEntries(result.entries);
      setError(null);
      setInitialLoadDone(true);
      return true;
    } catch (err) {
      // Doesn't touch `browsePath`/`entries` — if it was the path field that
      // failed, the typed text stays visible for the user to fix; if it was
      // a click (breadcrumb/folder/"..") the clickable path doesn't even change.
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setInitialLoadDone(false);
    void (async () => {
      // Saved folder may have been deleted/lost permission since last time —
      // if the initial navigation fails, tries again with the app's default
      // instead of leaving the modal with nothing navigable.
      const ok = await navigate(initialPath);
      if (!ok) void navigate(undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && locked) onOpenChange(false);
  }, [open, locked, onOpenChange]);

  const crumbs = breadcrumbsFor(browsePath);
  const atRoot = browsePath === "/";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onFocusComposer();
        }}
      >
        <DialogHeader>
          <DialogTitle>Selecionar pasta</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = pathInput.trim();
              if (trimmed) void navigate(trimmed);
            }}
            className="flex items-center gap-1.5"
          >
            <Input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              className="flex-1"
              spellCheck={false}
            />
            <Button type="submit" size="sm" variant="outline">
              Ir
            </Button>
          </form>

          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1 text-sm">
            {crumbs.map((crumb, index) => (
              <div key={crumb.path} className="flex shrink-0 items-center gap-1">
                {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                <button
                  type="button"
                  onClick={() => void navigate(crumb.path)}
                  className="shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-border"
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>

          <ScrollArea className="h-64 rounded-md border border-border">
            {error ? (
              <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-destructive">
                {error}
              </div>
            ) : (
              <div className="flex flex-col p-1">
                {!atRoot && (
                  <button
                    type="button"
                    onClick={() => void navigate(parentOf(browsePath))}
                    className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-border"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span>..</span>
                  </button>
                )}

                {loading && <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando…</div>}

                {!loading && entries.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma subpasta aqui.</div>
                )}

                {!loading &&
                  entries.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => void navigate(entry.path)}
                      className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-border"
                    >
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{entry.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </ScrollArea>
        </DialogBody>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!initialLoadDone || error !== null}
            onClick={() => {
              onSelect(browsePath);
              onOpenChange(false);
            }}
          >
            Selecionar pasta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
