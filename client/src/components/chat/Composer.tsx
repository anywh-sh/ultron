import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, ChevronDown, Mic, Paperclip, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { PendingImage } from "@/hooks/useImageUpload";

interface ComposerProps {
  onSend: (text: string, images: PendingImage[]) => void;
  disabled?: boolean;
  pendingImages: PendingImage[];
  uploadingImage: boolean;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (path: string) => void;
}

export interface ComposerHandle {
  focus: () => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const WAVEFORM_BARS = [0, 1, 2, 3, 4];

/** Foco de teclado destaca o container inteiro (textarea + toolbar), não só
 * a textarea isolada — docs/17. Fluxo de voz: gravar → waveform+timer →
 * cancelar ou parar → transcrever → texto cai aqui pra revisão (não envia
 * sozinho) — docs/17 + docs/18 (waveform é animação genérica, não áudio real). */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, disabled, pendingImages, uploadingImage, onAddFiles, onRemoveImage },
  ref,
) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const voice = useVoiceRecording({
    onTranscribed: (text) => setValue((prev) => (prev ? `${prev} ${text}` : text)),
    onError: (message) => window.alert(message),
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function submit(): void {
    const trimmed = value.trim();
    if (!trimmed && pendingImages.length === 0) return;
    onSend(trimmed, pendingImages);
    setValue("");
  }

  const isRecording = voice.state === "recording";
  const isTranscribing = voice.state === "transcribing";
  const canSend = !disabled && (value.trim().length > 0 || pendingImages.length > 0);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "m-3 flex flex-col gap-1.5 rounded-xl border bg-bg-elevated p-2 transition-colors",
        focused ? "border-primary" : "border-border",
      )}
    >
      {pendingImages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {pendingImages.map((image) => (
            <div key={image.path} className="group relative">
              <img src={image.previewUrl} alt="" className="size-14 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(image.path)}
                aria-label="Remover imagem"
                className="absolute -top-1.5 -right-1.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-border text-foreground opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Escreva uma mensagem…"
        rows={1}
        className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {isRecording && (
            <>
              <div className="flex h-4 items-center gap-0.5">
                {WAVEFORM_BARS.map((i) => (
                  <span
                    key={i}
                    className="h-full w-0.5 animate-waveform-bar rounded-full bg-destructive"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-destructive">{formatTimer(voice.elapsedSeconds)}</span>
              <button
                type="button"
                onClick={voice.cancel}
                aria-label="Cancelar gravação"
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-border"
              >
                <X className="size-3.5" />
              </button>
            </>
          )}
          {isTranscribing && <span className="text-xs text-muted-foreground">Transcrevendo áudio…</span>}
          {uploadingImage && !isRecording && !isTranscribing && (
            <span className="text-xs text-muted-foreground">enviando imagem…</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isRecording && !isTranscribing && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) onAddFiles(event.target.files);
                  event.target.value = "";
                  textareaRef.current?.focus();
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Anexar imagem"
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border"
              >
                <Paperclip className="size-4" />
              </button>
            </>
          )}

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => (isRecording ? void voice.stop() : void voice.start())}
              disabled={isTranscribing}
              aria-label={isRecording ? "Parar gravação" : "Gravar áudio"}
              className={cn(
                "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
                isRecording ? "bg-destructive text-foreground" : "text-muted-foreground hover:bg-border",
                isTranscribing && "cursor-not-allowed opacity-50",
              )}
            >
              {isRecording ? <Square className="size-3.5" /> : <Mic className="size-4" />}
            </button>

            {voice.devices.length > 1 && !isRecording && !isTranscribing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Selecionar microfone"
                    className="flex h-7 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border"
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Microfone</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {voice.devices.map((name) => (
                    <DropdownMenuItem key={name} onSelect={() => voice.setSelectedDevice(name)}>
                      <Check className={cn("size-3.5", name !== voice.selectedDevice && "opacity-0")} />
                      <span className="max-w-48 truncate">{name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Button type="submit" size="sm" disabled={!canSend}>
            Enviar
          </Button>
        </div>
      </div>
    </form>
  );
});
