import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Mic, Paperclip, Square, X } from "lucide-react";
import { EditorContent, ReactMarkViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDuration } from "@/lib/utils";
import { isIOS } from "@/lib/platform";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { PendingImage } from "@/hooks/useImageUpload";
import { ComposerLinkView } from "@/components/chat/ComposerLinkView";
import { serializeEditorContent } from "@/lib/composerLinks";

interface ComposerProps {
  onSend: (text: string, images: PendingImage[]) => void;
  disabled?: boolean;
  turnInFlight: boolean;
  onStop: () => void;
  pendingImages: PendingImage[];
  uploadingImage: boolean;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (path: string) => void;
}

export interface ComposerHandle {
  focus: () => void;
}

const WAVEFORM_BARS = [0, 1, 2, 3, 4];

/**
 * Só o link ganha um mark view interativo (hover card + editar) — o resto
 * do schema (bold, itálico, listas, heading etc) fica desativado: o
 * composer é uma caixa de texto simples, o pedido era só suportar link via
 * paste-to-link, não virar um editor rich-text completo.
 */
const ComposerLink = Link.extend({
  addMarkView() {
    return ReactMarkViewRenderer(ComposerLinkView);
  },
}).configure({
  autolink: false,
  linkOnPaste: true,
  openOnClick: false,
  HTMLAttributes: { class: "composer-link", rel: "noopener noreferrer nofollow" },
});

const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
    underline: false,
  }),
  ComposerLink,
  Placeholder.configure({ placeholder: "Escreva uma mensagem…" }),
];

/** Foco de teclado destaca o container inteiro (textarea + toolbar), não só
 * a textarea isolada — docs/17. Fluxo de voz: gravar → waveform+timer →
 * cancelar ou parar → transcrever → texto cai aqui pra revisão (não envia
 * sozinho) — docs/17 + docs/18 (waveform é animação genérica, não áudio real).
 * Campo de texto é um editor Tiptap (não `<textarea>`): precisa suportar
 * hyperlink inline (cor própria, hover com editar) criado via paste-to-link
 * — colar uma URL sobre um texto selecionado vira link, sem seleção a URL
 * colada já entra como link (comportamento nativo do `Link` do Tiptap). */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, disabled, turnInFlight, onStop, pendingImages, uploadingImage, onAddFiles, onRemoveImage },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  // Só usado no iOS (docs/24) — o container morfa de pílula (uma linha) pra
  // retângulo arredondado (várias linhas), igual ao protótipo. Medido pela
  // altura real do editor em vez de contar quebras de linha do texto: uma
  // linha pode ocupar duas visuais por wrap sem nenhum "\n".
  const [isMultiline, setIsMultiline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: EXTENSIONS,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: current }) => {
      setIsEmpty(current.isEmpty);
      if (isIOS()) setIsMultiline(current.view.dom.scrollHeight > 34);
    },
    editorProps: {
      attributes: { class: "composer-prosemirror", "aria-label": "Escreva uma mensagem…" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus(),
  }));

  const voice = useVoiceRecording({
    onTranscribed: (text) => {
      if (!editor) return;
      editor
        .chain()
        .focus("end")
        .insertContent(editor.isEmpty ? text : ` ${text}`)
        .run();
    },
    onError: (message) => window.alert(message),
  });

  function submit(): void {
    if (!editor) return;
    const text = serializeEditorContent(editor.getJSON()).trim();
    if (!text && pendingImages.length === 0) return;
    onSend(text, pendingImages);
    editor.commands.clearContent(true);
  }
  submitRef.current = submit;

  const isRecording = voice.state === "recording";
  const isTranscribing = voice.state === "transcribing";
  const canSend = !disabled && (!isEmpty || pendingImages.length > 0);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "flex flex-col gap-1.5 border p-2 transition-colors",
        isIOS()
          ? [
              // Mesma intensidade de blur da MobileTopBar (docs/24) — a
              // primeira tentativa aqui estava forte demais; o log continua
              // legível (desfocado) por trás quando rola até embaixo, mas
              // sem exagero.
              "bg-bg-elevated/70 shadow-lg backdrop-blur-md backdrop-saturate-150",
              "transition-[border-radius,border-color] duration-150",
              isMultiline ? "rounded-[26px]" : "rounded-full",
            ]
          : "m-3 rounded-xl bg-bg-elevated",
        focused ? "border-primary" : isIOS() ? "border-white/8" : "border-border",
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

      {isIOS() ? (
        // Uma linha só (attach | texto | enviar), como no protótipo — não o
        // texto-em-cima/botões-embaixo do desktop, que deixava o composer
        // alto/desalinhado em vez da pílula compacta aprovada (docs/24).
        <div className="flex items-end gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) onAddFiles(event.target.files);
              event.target.value = "";
              editor?.commands.focus();
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Anexar imagem"
            disabled={uploadingImage}
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="size-5" />
          </button>

          <EditorContent editor={editor} className={cn("composer-editor ios min-w-0 flex-1")} />

          <button
            type={turnInFlight ? "button" : "submit"}
            onClick={turnInFlight ? onStop : undefined}
            disabled={!turnInFlight && !canSend}
            aria-label={turnInFlight ? "Parar" : "Enviar"}
            className={cn(
              "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors",
              turnInFlight
                ? "bg-destructive text-destructive-foreground"
                : canSend
                  ? "bg-primary text-primary-foreground"
                  : "bg-border text-text-faint",
            )}
          >
            {turnInFlight ? <Square className="size-4" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      ) : (
        <>
          <EditorContent editor={editor} className="composer-editor" />

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
                  <span className="font-mono text-xs text-destructive">{formatDuration(voice.elapsedSeconds)}</span>
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
                      editor?.commands.focus();
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
              {turnInFlight ? (
                <Button type="button" size="sm" variant="secondary" onClick={onStop}>
                  <Square className="size-3" />
                  Parar
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!canSend}>
                  Enviar
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </form>
  );
});
