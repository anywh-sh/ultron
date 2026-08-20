import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { inTauri } from "@/lib/tauri";
import type { Profile } from "@/lib/profiles";

let permissionGranted: boolean | null = null;

/** Chamar uma vez no início do app — pede a permissão de notificação do SO
 * se ainda não foi decidida. Resultado fica em cache pro resto da sessão do
 * app; se o usuário negar, `notifyTurnComplete` vira no-op silencioso. */
export async function ensureNotificationPermission(): Promise<void> {
  if (!inTauri()) return;
  if (await isPermissionGranted()) {
    permissionGranted = true;
    return;
  }
  permissionGranted = (await requestPermission()) === "granted";
}

/** Notificação nativa do SO pra um turno que terminou fora do foco (outra
 * aba ativa no app, ou o app inteiro sem foco — ver App.tsx). */
export function notifyTurnComplete(profile: Profile, sessionName: string): void {
  if (!inTauri() || !permissionGranted) return;
  sendNotification({ title: `${sessionName} (${profile.label})`, body: "Resposta pronta." });
}
