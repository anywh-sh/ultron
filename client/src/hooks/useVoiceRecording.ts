import { useCallback, useEffect, useRef, useState } from "react";
import { listInputDevices, startRecording, stopRecordingAndTranscribe } from "@/lib/voice";

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

/** Envelope de estado por cima dos 3 comandos Tauri existentes (voice.rs, sem
 * mudança) — grava (waveform+timer no composer) → transcreve → texto cai na
 * composer pra revisão, sem enviar sozinho. Ver docs/17. */
export function useVoiceRecording({ onTranscribed, onError }: UseVoiceRecordingOptions): UseVoiceRecordingResult {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [devices, setDevices] = useState<string[]>([]);
  const [selectedDevice, setSelectedDeviceState] = useState("");

  const cancelledRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    listInputDevices()
      .then((names) => {
        setDevices(names);
        const saved = localStorage.getItem(MIC_STORAGE_KEY);
        if (saved && names.includes(saved)) setSelectedDeviceState(saved);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao listar microfones", error);
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
    cancelledRef.current = false;
    try {
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
    // Não existe comando de "descartar" separado no lado Rust — dispara o
    // stop de verdade em segundo plano só pra encerrar a captura, ignorando
    // o resultado. Cancelar fica instantâneo do ponto de vista da UI.
    void stopRecordingAndTranscribe().catch(() => {});
  }, []);

  return { state, elapsedSeconds, devices, selectedDevice, setSelectedDevice, start, stop, cancel };
}
