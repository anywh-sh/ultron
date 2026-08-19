// Milestone 1 (shell mínimo): redireciona pro terminal web do perfil pessoal.
// Feito via JS (não via `windows[].url` do tauri.conf.json) porque em modo
// `tauri dev` o Tauri prioriza o devUrl (servidor Vite) independente do que
// está configurado na janela — isso garante o mesmo comportamento em dev e build.
const TTYD_URL = "http://100.64.0.1:7681";

window.location.replace(TTYD_URL);
