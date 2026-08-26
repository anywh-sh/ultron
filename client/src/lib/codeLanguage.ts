// Mapa extensão → nome de linguagem registrado no bundle "common" do
// lowlight (ver `highlightCode.tsx`) — usado pra colorir o conteúdo de
// Edit/Write no `ToolCallCard` de acordo com o arquivo sendo tocado.
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  xml: "xml",
  html: "xml",
  htm: "xml",
  md: "markdown",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  pl: "perl",
  r: "r",
};

export function languageForPath(path: string | undefined): string {
  if (!path) return "plaintext";
  const base = path.split("/").pop() ?? path;
  if (base.toLowerCase() === "makefile") return "makefile";
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex <= 0) return "plaintext";
  const ext = base.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? "plaintext";
}
