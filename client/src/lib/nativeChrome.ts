import { invoke } from "@tauri-apps/api/core";
import { isIOS } from "@/lib/platform";

/** Chrome nativo do port iOS (docs/23, Fase E) — plugin Swift local em
 * `src-tauri/plugins/tauri-plugin-native-chrome`, só existe em iOS. Sem
 * `guest-js` formal (pacote/build separado seria over-engineering pra um
 * comando só) — chama `invoke` direto, mesmo padrão de qualquer outro
 * comando Tauri do app. */
export async function setConnectionIndicator(connected: boolean): Promise<void> {
  if (!isIOS()) return;
  await invoke("plugin:native-chrome|set_connection_indicator", { payload: { connected } });
}
