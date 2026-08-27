import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ArrowUp, Check, ChevronDown, Mic, Paperclip, Square, X } from "lucide-react";
import { Extension } from "@tiptap/core";
import { EditorContent, ReactMarkViewRenderer, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import Suggestion from "@tiptap/suggestion";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
import { PermissionModeButton } from "@/components/chat/PermissionModeButton";
import { ModelLabel } from "@/components/chat/ModelLabel";
import { ContextUsageButton } from "@/components/chat/ContextUsageButton";
import { CompactBoundaryToast } from "@/components/chat/CompactBoundaryToast";
import { SlashCommandMenu } from "@/components/chat/SlashCommandMenu";
import { serializeEditorContent } from "@/lib/composerLinks";
import { filterSlashCommands, parseSlashCommand, type SlashCommandEntry } from "@/lib/slashCommands";
import type { CompactBoundaryEvent } from "@/hooks/useRelayClient";
import type { ContextUsage, ModelChoice, PermissionMode } from "@/lib/relayClient";

interface ComposerProps {
  onSend: (text: string, images: PendingImage[]) => void;
  disabled?: boolean;
  turnInFlight: boolean;
  onStop: () => void;
  pendingImages: PendingImage[];
  uploadingImage: boolean;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (path: string) => void;
  permissionMode: PermissionMode | null;
  onChangePermissionMode: (mode: PermissionMode) => void;
  /** `null` até o primeiro `/model` da sessão (docs/26) — nesse caso
   * `ModelLabel` cai pro `defaultModel` (docs/28). */
  model: ModelChoice | null;
  /** Modelo padrão de verdade da conta desse perfil (docs/28) — fallback do
   * `ModelLabel` quando `model` é `null`. */
  defaultModel: string | null;
  /** Desktop-only por ora — o layout iOS (linha única attach/texto/enviar,
   * ver isIOS() abaixo) não tem a toolbar onde isso entraria. */
  contextUsage: ContextUsage | null;
  compactBoundary: CompactBoundaryEvent | null;
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

/** Colore `/model haiku` etc digitado no composer, só quando é um comando
 * reconhecido de verdade (mesma checagem de `parseSlashCommand` — um
 * `/model gpt4` inválido fica sem cor nenhuma, já que vai virar mensagem
 * normal). Barra com opacidade reduzida + cor primária, nome do comando com
 * cor primária cheia, parâmetro (se houver) sem estilo nenhum — pedido
 * explícito do usuário (docs/27). Decoração pura (`Decoration.inline`), não
 * mexe no documento — o texto que vai pro `onSend` continua o texto puro de
 * sempre. */
function slashCommandDecorationPlugin() {
  return new Plugin({
    key: new PluginKey("slashCommandDecoration"),
    props: {
      decorations(state) {
        const text = state.doc.textBetween(0, state.doc.content.size, "\n", "\n");
        if (!parseSlashCommand(text)) return DecorationSet.empty;
        const match = /^(\/\S+)(\s+\S+)?$/.exec(text);
        if (!match) return DecorationSet.empty;
        // Início do texto do primeiro (único) parágrafo — ver schema do
        // composer acima, nunca tem outro nó de bloco antes.
        const from = 1;
        const commandEnd = from + match[1].length;
        return DecorationSet.create(state.doc, [
          Decoration.inline(from, from + 1, { class: "composer-command-slash" }),
          Decoration.inline(from + 1, commandEnd, { class: "composer-command-name" }),
        ]);
      },
    },
  });
}

/**
 * `/` como primeiro caractere do composer (vazio até então, `startOfLine` +
 * `allowSpaces` do Suggestion garantem isso — ver docs/27) abre um popup de
 * autocompletar dos comandos disponíveis. Menu renderizado via `ReactRenderer`
 * + `props.mount()` (posicionamento gerenciado pelo próprio pacote via
 * Floating UI, ancorado no cursor) — sem estado React aqui: os callbacks do
 * Tiptap vivem fora do ciclo de render, então a seleção atual e os itens
 * filtrados ficam em variáveis fechadas no closure de `addProseMirrorPlugins`,
 * atualizadas via `component.updateProps`.
 *
 * `activeRef` é o único canal de volta pro componente React: o
 * `handleKeyDown` de nível de editor (configurado em `useEditor` abaixo) já
 * roda ANTES dos plugins do ProseMirror (inclusive o do Suggestion) — sem
 * essa checagem, Enter sempre submeteria a mensagem em vez de deixar o
 * Suggestion escolher o item selecionado no menu.
 */
function createSlashCommandExtension(activeRef: MutableRefObject<boolean>) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      let component: ReactRenderer | null = null;
      let unmount: (() => void) | null = null;
      let selectedIndex = 0;
      let currentItems: SlashCommandEntry[] = [];
      let currentCommand: ((entry: SlashCommandEntry) => void) | null = null;

      function applySelection(index: number) {
        selectedIndex = index;
        component?.updateProps({
          items: currentItems,
          selectedIndex,
          onHover: applySelection,
          onPick: currentCommand,
        });
      }

      function close() {
        activeRef.current = false;
        unmount?.();
        component?.destroy();
        component = null;
      }

      return [
        slashCommandDecorationPlugin(),
        Suggestion<SlashCommandEntry, SlashCommandEntry>({
          editor: this.editor,
          char: "/",
          startOfLine: true,
          allowSpaces: true,
          // Sem isso, escolher um item reabre o menu na hora: o texto
          // resultante ("/model fable") ainda bate com "/" no início da
          // linha, então o Suggestion tentava começar uma sessão nova só
          // com ele mesmo como opção. Só mostra enquanto o texto ainda não é
          // um comando completo e válido — mesma checagem de `onSend`
          // (ChatPanel) e da decoração visual acima.
          shouldShow: ({ text }) => parseSlashCommand(text) === null,
          items: ({ query }) => filterSlashCommands(query),
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, props.command).run();
          },
          render: () => ({
            onStart: (props) => {
              currentItems = props.items;
              currentCommand = props.command;
              selectedIndex = 0;
              activeRef.current = currentItems.length > 0;
              component = new ReactRenderer(SlashCommandMenu, {
                editor: props.editor,
                props: { items: currentItems, selectedIndex, onHover: applySelection, onPick: currentCommand },
              });
              unmount = props.mount(component.element as HTMLElement);
            },
            onUpdate: (props) => {
              currentItems = props.items;
              currentCommand = props.command;
              selectedIndex = 0;
              activeRef.current = currentItems.length > 0;
              component?.updateProps({ items: currentItems, selectedIndex, onHover: applySelection, onPick: currentCommand });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                close();
                return true;
              }
              if (currentItems.length === 0) return false;
              if (props.event.key === "ArrowDown") {
                applySelection((selectedIndex + 1) % currentItems.length);
                return true;
              }
              if (props.event.key === "ArrowUp") {
                applySelection((selectedIndex - 1 + currentItems.length) % currentItems.length);
                return true;
              }
              if (props.event.key === "Enter") {
                currentCommand?.(currentItems[selectedIndex]);
                return true;
              }
              return false;
            },
            onExit: close,
          }),
        }),
      ];
    },
  });
}

/** Foco de teclado destaca o container inteiro (textarea + toolbar), não só
 * a textarea isolada — docs/17. Fluxo de voz: gravar → waveform+timer →
 * cancelar ou parar → transcrever → texto cai aqui pra revisão (não envia
 * sozinho) — docs/17 + docs/18 (waveform é animação genérica, não áudio real).
 * Campo de texto é um editor Tiptap (não `<textarea>`): precisa suportar
 * hyperlink inline (cor própria, hover com editar) criado via paste-to-link
 * — colar uma URL sobre um texto selecionado vira link, sem seleção a URL
 * colada já entra como link (comportamento nativo do `Link` do Tiptap). */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    onSend,
    disabled,
    turnInFlight,
    onStop,
    pendingImages,
    uploadingImage,
    onAddFiles,
    onRemoveImage,
    permissionMode,
    onChangePermissionMode,
    model,
    defaultModel,
    contextUsage,
    compactBoundary,
  },
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
  // Único canal de volta do Suggestion (fora do React) pro editorProps abaixo
  // — ver o comentário de `createSlashCommandExtension`.
  const slashMenuActiveRef = useRef(false);
  const [slashCommandExtension] = useState(() => createSlashCommandExtension(slashMenuActiveRef));
  const extensions = useMemo(() => [...EXTENSIONS, slashCommandExtension], [slashCommandExtension]);

  const editor = useEditor({
    extensions,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor: current }) => {
      setIsEmpty(current.isEmpty);
      if (isIOS()) setIsMultiline(current.view.dom.scrollHeight > 34);
    },
    editorProps: {
      attributes: { class: "composer-prosemirror", "aria-label": "Escreva uma mensagem…" },
      handleKeyDown: (_view, event) => {
        // Menu de comandos aberto: deixa o Suggestion tratar Enter/setas (ver
        // `createSlashCommandExtension`) — sem isso o Enter sempre submeteria
        // em vez de preencher o comando selecionado.
        if (event.key === "Enter" && !event.shiftKey && slashMenuActiveRef.current) return false;
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
              // Mesma intensidade de blur da MobileTopBar (docs/24) — no
              // device físico o blur em si estava imperceptível (possível
              // limitação do WKWebView com backdrop-filter), então a
              // opacidade caiu bem mais (45%) pra garantir contraste
              // visível por trás mesmo se o blur não renderizar.
              "bg-bg-elevated/45 shadow-lg backdrop-blur-lg backdrop-saturate-150",
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
        <div className={cn("flex gap-1", isMultiline ? "items-end" : "items-center")}>
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
            {turnInFlight ? <Square className="size-4" fill="currentColor" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      ) : (
        <>
          <EditorContent editor={editor} className="composer-editor" />

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
              <PermissionModeButton mode={permissionMode} onChange={onChangePermissionMode} />
              <ModelLabel model={model} defaultModel={defaultModel} />
              <ContextUsageButton usage={contextUsage} />
              <CompactBoundaryToast event={compactBoundary} />
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
                <Button type="button" size="sm" variant="destructive" onClick={onStop}>
                  <Square className="size-3" fill="currentColor" />
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
