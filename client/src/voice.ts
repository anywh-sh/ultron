import { invoke } from "@tauri-apps/api/core";

export async function startRecording(): Promise<void> {
  await invoke("start_recording");
}

export async function stopRecordingAndTranscribe(): Promise<string> {
  return await invoke<string>("stop_recording_and_transcribe");
}
