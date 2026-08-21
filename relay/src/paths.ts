import { homedir } from "node:os";

/**
 * "Pasta padrão do app" pra um perfil — usada como cwd inicial de uma sessão
 * nova e como fallback quando `GET /fs/list` não recebe `path`. Antes desta
 * função existir, o fallback pro perfil pessoal (sem `homeOverride`) era
 * `process.cwd()` do processo do relay — na prática a própria pasta do
 * código-fonte do ultron (`WorkingDirectory` do systemd unit), não o real
 * $HOME do usuário. `homedir()` é o fallback certo.
 */
export function defaultCwd(homeOverride: string | undefined): string {
  return homeOverride ?? homedir();
}
