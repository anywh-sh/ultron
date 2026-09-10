import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

// Backs the work dir file panel (docs/41) — list/read/raw for a session's
// cwd. Deliberately separate from `fsBrowse.ts`, which keeps serving the
// folder picker (directories only, no root confinement: picking a new
// working directory needs to be able to navigate anywhere).

export type FilesError = "not_found" | "permission_denied" | "invalid_path" | "outside_root";

function errorFromErrno(error: unknown): FilesError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "not_found";
  if (code === "EACCES" || code === "EPERM") return "permission_denied";
  return "not_found";
}

type ResolveResult = { ok: true; root: string; path: string } | { ok: false; error: FilesError };

/**
 * Confirms `rawPath` (or, if omitted, the root itself) resolves inside
 * `rawRoot` — `path.resolve` + `realpathSync` of both sides, so a `../` or a
 * symlink that escapes the root is rejected the same way. This is **not** a
 * security boundary — anyone who can reach the relay already has full shell
 * access on this machine via the embedded terminal or `--dangerously-skip-permissions`
 * itself (see README "Security model"), root confinement or not. It's a
 * contract: it guarantees the root really is the session's cwd, and that a
 * UI bug can't end up requesting something like `/etc`.
 */
export function resolveWithinRoot(rawRoot: string, rawPath: string | null): ResolveResult {
  let root: string;
  try {
    root = realpathSync(rawRoot);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }

  if (rawPath === null) return { ok: true, root, path: root };
  if (!isAbsolute(rawPath)) return { ok: false, error: "invalid_path" };

  let resolved: string;
  try {
    resolved = realpathSync(resolve(rawPath));
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }

  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return { ok: false, error: "outside_root" };
  }
  return { ok: true, root, path: resolved };
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
  mtimeMs: number;
}

export type ListResult = { ok: true; root: string; path: string; entries: FileEntry[] } | { ok: false; error: FilesError };

/** Dotfiles and `node_modules` are exactly the noise nobody wants in the
 * tree by default (decision 4, docs/41) — `showHidden` (the `all=1` query
 * param) turns the filter off for the rare "I need my `.env`" case. */
function isHidden(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/** Lazy, one folder at a time — never recursive (docs/41: recursive listing
 * doesn't scale once `node_modules` is involved). */
export function listFiles(rawRoot: string, rawPath: string | null, showHidden: boolean): ListResult {
  const resolved = resolveWithinRoot(rawRoot, rawPath);
  if (!resolved.ok) return resolved;

  let dirents;
  try {
    dirents = readdirSync(resolved.path, { withFileTypes: true });
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }

  const entries: FileEntry[] = [];
  for (const dirent of dirents) {
    if (!showHidden && isHidden(dirent.name)) continue;
    const fullPath = join(resolved.path, dirent.name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // disappeared mid-read or broken symlink — ignore silently, same as fsBrowse.
    }
    entries.push({
      name: dirent.name,
      path: fullPath,
      kind: stat.isDirectory() ? "dir" : "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  return { ok: true, root: resolved.root, path: resolved.path, entries };
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

// Above this, a text file is read only up to the cap and flagged
// `truncated` — the viewer shows a warning strip instead of loading
// something the webview can't reasonably render anyway.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
// Only the first chunk needs sniffing to tell text from binary.
const BINARY_SNIFF_BYTES = 8 * 1024;

/** A byte `0x00`, or a high ratio of non-printable control bytes, marks a
 * file as binary — same heuristic `file`/git use. Tabs/newlines/CR don't
 * count against it, and anything `>= 0x80` is treated as text (UTF-8
 * multibyte sequences, not a control byte). */
function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  if (buffer.includes(0)) return true;
  let controlCount = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte >= 0x20) continue;
    controlCount++;
  }
  return controlCount / buffer.length > 0.3;
}

export type ReadResult =
  | { ok: true; kind: "text"; path: string; content: string; size: number; mtimeMs: number; truncated: boolean }
  | { ok: true; kind: "image"; path: string; size: number; mtimeMs: number; mime: string }
  | { ok: true; kind: "binary"; path: string; size: number; mtimeMs: number }
  | { ok: false; error: FilesError };

export function readFileForViewer(rawRoot: string, rawPath: string): ReadResult {
  const resolved = resolveWithinRoot(rawRoot, rawPath);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = statSync(resolved.path);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  if (!stat.isFile()) return { ok: false, error: "not_found" };

  // Image detection is by extension only — never opens the file just to
  // decide, `/files/raw` (a separate request) is what actually reads bytes.
  const mime = IMAGE_MIME_BY_EXT[extname(resolved.path).toLowerCase()];
  if (mime) {
    return { ok: true, kind: "image", path: resolved.path, size: stat.size, mtimeMs: stat.mtimeMs, mime };
  }

  const fd = openSync(resolved.path, "r");
  try {
    const sniffSize = Math.min(BINARY_SNIFF_BYTES, stat.size);
    const sniffBuffer = Buffer.alloc(sniffSize);
    readSync(fd, sniffBuffer, 0, sniffSize, 0);
    if (looksBinary(sniffBuffer)) {
      return { ok: true, kind: "binary", path: resolved.path, size: stat.size, mtimeMs: stat.mtimeMs };
    }

    const truncated = stat.size > MAX_TEXT_BYTES;
    const readSize = truncated ? MAX_TEXT_BYTES : stat.size;
    const contentBuffer = Buffer.alloc(readSize);
    readSync(fd, contentBuffer, 0, readSize, 0);
    return { ok: true, kind: "text", path: resolved.path, content: contentBuffer.toString("utf-8"), size: stat.size, mtimeMs: stat.mtimeMs, truncated };
  } finally {
    closeSync(fd);
  }
}

export type DeleteResult = { ok: true } | { ok: false; error: FilesError };

/** File-only, same as the rest of this module's write surface below — the
 * context menu that drives this (docs/41's tree) never shows these actions
 * for a directory row. */
export function deleteFile(rawRoot: string, rawPath: string): DeleteResult {
  const resolved = resolveWithinRoot(rawRoot, rawPath);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = statSync(resolved.path);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  if (!stat.isFile()) return { ok: false, error: "not_found" };

  try {
    unlinkSync(resolved.path);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  return { ok: true };
}

export type FilesWriteError = FilesError | "invalid_name" | "already_exists";
export type RenameResult = { ok: true; path: string } | { ok: false; error: FilesWriteError };

/** Renames within the same directory only — `newName` is validated to be a
 * bare filename (no separator), so this can never move a file to a
 * different directory or escape the root the way an arbitrary destination
 * path could. */
export function renameFile(rawRoot: string, rawPath: string, newName: string): RenameResult {
  const resolved = resolveWithinRoot(rawRoot, rawPath);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = statSync(resolved.path);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  if (!stat.isFile()) return { ok: false, error: "not_found" };

  const trimmed = newName.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes(sep) || trimmed === "." || trimmed === "..") {
    return { ok: false, error: "invalid_name" };
  }

  const target = join(dirname(resolved.path), trimmed);
  if (existsSync(target)) return { ok: false, error: "already_exists" };

  try {
    renameSync(resolved.path, target);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  return { ok: true, path: target };
}

export type CreateResult = { ok: true; path: string } | { ok: false; error: FilesWriteError };

/** Creates a file directly under `rawDir` (or the root itself when `rawDir`
 * is `null` — the file tree's panel-level "new file" context menu always
 * creates at the root today). `name` is validated the same way
 * `renameFile`'s `newName` is, and creation fails closed if something
 * already exists at the target path rather than silently truncating it.
 * `content` defaults to empty (the "new file" context menu's case) — the
 * file panel's drag-and-drop upload (`/files/upload`, server.ts) is the
 * other caller, passing the dropped file's bytes instead. */
export function createFile(rawRoot: string, rawDir: string | null, name: string, content: Buffer | string = ""): CreateResult {
  const resolvedDir = resolveWithinRoot(rawRoot, rawDir);
  if (!resolvedDir.ok) return resolvedDir;

  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes(sep) || trimmed === "." || trimmed === "..") {
    return { ok: false, error: "invalid_name" };
  }

  const target = join(resolvedDir.path, trimmed);
  if (existsSync(target)) return { ok: false, error: "already_exists" };

  try {
    writeFileSync(target, content);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  return { ok: true, path: target };
}

export type RawResult = { ok: true; path: string; mime: string } | { ok: false; error: FilesError };

/** Resolution/validation only — `server.ts` owns the actual byte streaming
 * (`createReadStream`), same split of responsibility as the rest of this
 * module keeping HTTP out of it. */
export function resolveRawFile(rawRoot: string, rawPath: string): RawResult {
  const resolved = resolveWithinRoot(rawRoot, rawPath);
  if (!resolved.ok) return resolved;

  let stat;
  try {
    stat = statSync(resolved.path);
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
  if (!stat.isFile()) return { ok: false, error: "not_found" };

  const mime = IMAGE_MIME_BY_EXT[extname(resolved.path).toLowerCase()] ?? "application/octet-stream";
  return { ok: true, path: resolved.path, mime };
}
