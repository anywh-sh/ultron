import { invoke } from "@tauri-apps/api/core";
import { isMacOS } from "@/lib/platform";

export async function listInputDevices(): Promise<string[]> {
  return await invoke<string[]>("list_input_devices");
}

/** cpal accesses CoreAudio directly on macOS, which doesn't trigger the
 * native permission dialog — without this the app records only silence
 * (whisper "hallucinates" text like "[Music]"). Forces the real permission
 * request via AVFoundation before recording. No-op on other platforms. */
export async function ensureMicrophonePermission(): Promise<void> {
  if (!isMacOS()) return;

  const { checkMicrophonePermission, requestMicrophonePermission } = await import(
    "tauri-plugin-macos-permissions-api"
  );

  if (await checkMicrophonePermission()) return;

  await requestMicrophonePermission();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await checkMicrophonePermission()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    "Permissão de microfone não concedida. Autorize em Ajustes do Sistema > Privacidade e Segurança > Microfone.",
  );
}

export async function startRecording(deviceName: string | undefined): Promise<void> {
  await invoke("start_recording", { deviceName });
}

export async function stopRecordingAndTranscribe(): Promise<string> {
  return await invoke<string>("stop_recording_and_transcribe");
}
