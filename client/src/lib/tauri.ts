/** Fora do Tauri (ex.: `npm run dev` aberto num browser comum pra inspeção
 * via Playwright — docs/21) as APIs do Tauri explodem, porque leem
 * `window.__TAURI_INTERNALS__`. Checar isso primeiro deixa esses caminhos
 * no-op nesse caso. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
