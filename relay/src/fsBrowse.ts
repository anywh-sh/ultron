import { statSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

// Suporta o modal de escolha de pasta (docs do plano "working directory") —
// lista só subdiretórios, nunca arquivos. Síncrono e puro de propósito: sem
// I/O assíncrono nem dependência do request HTTP, pra dar pra chamar tanto
// do endpoint `GET /fs/list` quanto da validação em `SharedSession.setCwd`
// sem duplicar a lógica de erro.

export type FsError = "not_found" | "permission_denied" | "not_a_directory" | "invalid_path";

export interface FsEntry {
  name: string;
  path: string;
}

type CheckResult = { ok: true; path: string } | { ok: false; error: FsError };

function errorFromErrno(error: unknown): FsError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return "not_found";
  if (code === "EACCES" || code === "EPERM") return "permission_denied";
  return "not_found";
}

/** Confirma que `rawPath` existe e é um diretório, devolvendo a forma
 * canônica (`path.resolve`) — é o que o cliente usa como `browsePath` depois
 * de cada navegação, pra breadcrumb sempre refletir o que o servidor
 * confirmou (não o que foi digitado/clicado). */
export function checkDirectory(rawPath: string): CheckResult {
  if (!isAbsolute(rawPath)) return { ok: false, error: "invalid_path" };
  const resolved = resolve(rawPath);
  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) return { ok: false, error: "not_a_directory" };
    return { ok: true, path: resolved };
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }
}

type ListResult = { ok: true; path: string; entries: FsEntry[] } | { ok: false; error: FsError };

/** Só subpastas — link simbólico apontando pra diretório entra (senão
 * `/home/user/.ultron-trabalho-home`, que é onde o perfil trabalho de fato
 * trabalha, sumiria de qualquer listagem que passe por um symlink), link
 * quebrado é ignorado. Sem filtro de dotdir — pastas escondidas continuam
 * navegáveis, o picker não é uma listagem "pra usuário final" com
 * convenções de gerenciador de arquivo. */
export function listDirectories(rawPath: string): ListResult {
  const check = checkDirectory(rawPath);
  if (!check.ok) return check;

  let dirents;
  try {
    dirents = readdirSync(check.path, { withFileTypes: true });
  } catch (error) {
    return { ok: false, error: errorFromErrno(error) };
  }

  const entries: FsEntry[] = [];
  for (const dirent of dirents) {
    const fullPath = join(check.path, dirent.name);
    let isDir = dirent.isDirectory();
    if (!isDir && dirent.isSymbolicLink()) {
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue; // symlink quebrado — ignora silenciosamente.
      }
    }
    if (isDir) entries.push({ name: dirent.name, path: fullPath });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, path: check.path, entries };
}
