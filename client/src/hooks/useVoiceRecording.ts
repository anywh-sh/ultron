import { useCallback, useEffect, useRef, useState } from "react";
import { ensureMicrophonePermission, listInputDevices, startRecording, stopRecordingAndTranscribe } from "@/lib/voice";
import { isIOS } from "@/lib/platform";

const MIC_STORAGE_KEY = "ultron:selected-mic";

export type VoiceRecordingState = "idle" | "recording" | "transcribing";

export interface UseVoiceRecordingOptions {
  onTranscribed: (text: string) => void;
  onError: (message: string) => void;
}

export interface UseVoiceRecordingResult {
  state: VoiceRecordingState;
  elapsedSeconds: number;
  devices: string[];
  selectedDevice: string;
  setSelectedDevice: (name: string) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

/** State envelope on top of the 3 existing Tauri commands (voice.rs, no
 * change) — records (waveform+timer in the composer) → transcribes → text lands in the
 * composer for review, without sending on its own. See docs/17. */
export function useVoiceRecording({ onTranscribed, onError }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [devices, setDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDeviceState] = useState("");

  const cancelledRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Voice is out of scope for the iOS MVP (docs/22/23) — the command doesn't exist in the
    // iOS build (commit b6b8e63), invoking it here would just reject the promise for nothing.
    if (isIOS()) return;
    listInputDevices()
      .then((names) => {
        setDevices(names);
        const saved = localStorage.getItem(MIC_STORAGE_KEY);
        if (saved && names.includes(saved)) setSelectedDeviceState(saved);
      })
      .catch((error: unknown) => {
        console.error("[ultron] failed to list microphones", error);
      });
  }, []);

  const setSelectedDevice = useCallback((name: string) => {
    setSelectedDeviceState(name);
    localStorage.setItem(MIC_STORAGE_KEY, name);
  }, []);

  function stopTimer(): void {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }

  const start = useCallback(async () => {
    if (isIOS()) return;
    cancelledRef.current = false;
    try {
      await ensureMicrophonePermission();
      await startRecording(selectedDevice || undefined);
    } catch (error) {
      onError(`Não foi possível iniciar a gravação: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setState("recording");
    setElapsedSeconds(0);
    timerRef.current = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
  }, [selectedDevice, onError]);

  const stop = useCallback(async () => {
    stopTimer();
    setState("transcribing");
    try {
      const text = await stopRecordingAndTranscribe();
      if (!cancelledRef.current) onTranscribed(text);
    } catch (error) {
      if (!cancelledRef.current) {
        onError(`Falha na transcrição: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setState("idle");
    }
  }, [onTranscribed, onError]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopTimer();
    setState("idle");
    // There's no separate "discard" command on the Rust side — fires the
    // real stop in the background just to end the capture, ignoring
    // the result. Cancel stays instant from the UI's point of view.
    void stopRecordingAndTranscribe().catch(() => {});
  }, []);

  return { state, elapsedSeconds, devices, selectedDevice, setSelectedDevice, start, stop, cancel };
}
