import { invoke } from "@tauri-apps/api/core";

export async function listInputDevices(): Promise<string[]> {
  return await invoke<string[]>("list_input_devices");
}

export async function startRecording(deviceName: string | undefined): Promise<void> {
  await invoke("start_recording", { deviceName });
}

export async function stopRecordingAndTranscribe(): Promise<string> {
  return await invoke<string>("stop_recording_and_transcribe");
}
