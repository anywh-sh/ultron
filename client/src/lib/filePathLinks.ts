import { listFiles } from "@/lib/filesClient";
import type { Profile } from "@/lib/profiles";

/**
 * Detects whether an inline code span's text (the content of a single
 * backtick span, e.g. `` `screenshots/PROJ-929/foo.png` ``) looks like a
 * file path worth making clickable in the work dir file panel. Deliberately
 * cheap and permissive — false positives (an API route, a `journal/NN`
 * citation, a scoped npm package) fail closed at click time: `FileViewer`
 * already renders "Não foi possível abrir o arquivo." for anything that
 * doesn't resolve under the session's root (relay/src/fsFiles.ts). Pre-
 * validating existence here instead would cost one relay round trip per
 * code span per render — not worth it for a graceful-failure case.
 *
 * Excludes: URLs (already handled by `MarkdownContent`'s `a` override),
 * anything without a `/` (too ambiguous — a bare filename in backticks is
 * as likely to be a generic mention as a real path), and directory-looking
 * paths (trailing `/` — `FileViewer` only opens files, not folders).
 */
export function looksLikeFilePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed !== text) return false;
  if (!trimmed.includes("/")) return false;
  if (trimmed.endsWith("/")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return false; // scheme://... (URLs)
  if (trimmed.includes("\n") || trimmed.includes(" ")) return false;
  return true;
}

/**
 * Resolves a path as written in chat text (relative to the session's cwd,
 * or already absolute — the relay always prints absolute paths for tool
 * results, but assistant prose commonly writes them relative) into the
 * absolute form `relay/src/fsFiles.ts`'s `resolveWithinRoot` requires.
 * `cachedRoot` avoids a redundant `/files/list` round trip when the file
 * panel has already been opened once for this session (`useFileTabs`'s
 * `root`); falls back to fetching it fresh otherwise, same call `FilesPanel`
 * itself makes on mount.
 */
export async function resolveChatPath(
  profile: Profile,
  sessionId: string,
  rawPath: string,
  cachedRoot: string | null,
): Promise<string> {
  if (rawPath.startsWith("/")) return rawPath;
  const root = cachedRoot ?? (await listFiles(profile, sessionId)).root;
  return `${root}/${rawPath}`;
}
