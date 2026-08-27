import { spawn } from "node:child_process";

// Mesmo binário/PATH do turno de verdade (claudeSession.ts) — motivo idêntico:
// systemd não sourca o shell interativo do usuário.
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/home/user/.local/bin/claude";
const EXTRA_PATH_DIRS = ["/home/user/.local/bin", "/home/user/.nvm/versions/node/v20.19.0/bin"];

// Extrai só a família do modelo — "Sonnet 5 (default)" -> "Sonnet", "Opus 5
// (1M context) (default)" -> "Opus". Mesmo vocabulário de MODEL_LABELS no
// cliente (docs/26), então o texto já chega pronto pra mostrar sem mapear de
// novo lá.
const MODEL_NAME_RE = /^Current model:\s*(Sonnet|Opus|Haiku|Fable)\b/i;

/**
 * Roda uma vez no boot do relay (server.ts) pra descobrir o modelo padrão de
 * verdade da conta desse perfil (docs/28) — achado testando manualmente:
 * `/model` sem argumento é interceptado pela própria CLI antes de qualquer
 * chamada de API (`num_turns: 0` no resultado), então não custa nada e roda
 * em ~100-200ms. Cada perfil roda seu próprio processo de relay com seu
 * próprio `$HOME` (docs/08), então cada instância sonda só a conta dele.
 *
 * Achado real que motivou isso: os dois perfis têm defaults DIFERENTES —
 * pessoal veio "Sonnet 5 (default)", trabalho veio "Opus 5 (1M context)
 * (default)". Não dava pra supor um valor fixo (ex: sempre "Opus") sem
 * mostrar uma label errada pra pelo menos um dos dois.
 */
export async function detectDefaultModel(homeOverride: string | undefined, cwd: string): Promise<string | undefined> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (homeOverride) env.HOME = homeOverride;
  env.PATH = [...EXTRA_PATH_DIRS, env.PATH ?? ""].join(":");

  const child = spawn(
    CLAUDE_BIN,
    [
      "-p",
      "/model",
      "--output-format",
      "json",
      "--no-session-persistence",
      // Mesmas flags do titleGenerator.ts, mesmo motivo: sem elas, um perfil
      // com MCP configurado (achado real testando o perfil trabalho) imprime
      // uma linha de log solta no stdout DEPOIS do JSON (algo como "Client.
      // listTools() called but server does not advertise tools capability"),
      // quebrando o parse abaixo mesmo com exit code 0.
      "--tools",
      "",
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
    ],
    { env, cwd },
  );

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) return undefined;

  // Defesa extra além das flags acima: o resultado sempre vem numa linha só
  // (confirmado testando), então ignora qualquer coisa que ainda vaze depois
  // dela em vez de tentar fazer `JSON.parse` do stdout inteiro.
  let parsed: { result?: unknown };
  try {
    parsed = JSON.parse(stdout.split("\n")[0] ?? "") as { result?: unknown };
  } catch {
    return undefined;
  }

  const match = typeof parsed.result === "string" ? MODEL_NAME_RE.exec(parsed.result) : null;
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}
