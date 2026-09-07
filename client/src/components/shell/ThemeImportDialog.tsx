import { useEffect, useRef, useState } from "react";
import { Copy, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Profile } from "@/lib/profiles";
import { parseTheme, type Theme, type ThemeValidationError } from "@/lib/theme";
import { saveTheme, ThemeSaveError } from "@/lib/relayClient";
import { setThemesForHost, customThemesForHost } from "@/lib/themes";

/** Mirrors the relay's own cap (MAX_JSON_BODY_BYTES) so an oversized file
 * gets a readable message here instead of a dropped connection there. */
const MAX_THEME_BYTES = 64 * 1024;

interface ThemeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose host receives the theme — the registry is per machine. */
  profile: Profile;
  /** Pre-filled JSON, for editing an existing theme or duplicating one —
   * the realistic way to author a theme is to start from one that works. */
  initialJson?: string;
  /** Only changes the wording. Editing and creating are the same request:
   * saving under an existing id overwrites that theme, saving under a new
   * one creates a second. */
  intent?: ThemeDialogIntent;
  onImported: (theme: Theme) => void;
}

export type ThemeDialogIntent = "import" | "edit" | "duplicate";

const COPY: Record<ThemeDialogIntent, { title: string; submit: string; hint: string }> = {
  import: {
    title: "Adicionar tema",
    submit: "Adicionar",
    hint: "Cole o JSON do tema ou escolha um arquivo.",
  },
  edit: {
    title: "Editar tema",
    submit: "Salvar",
    hint: "Edite os valores e salve. Mudar o `id` cria um tema novo em vez de alterar este.",
  },
  duplicate: {
    title: "Duplicar tema",
    submit: "Criar cópia",
    hint: "Cópia do tema com todos os tokens escritos. Ajuste o que quiser antes de salvar.",
  },
}

/**
 * Import by pasting JSON or picking a file. `<input type="file">` rather
 * than a native dialog plugin: it already works in all three webviews (the
 * composer's image picker uses it), and adding tauri-plugin-dialog would
 * cost a capability entry per platform for no gain here.
 *
 * Validation runs locally first so a broken file is explained without a
 * round trip; the relay validates again and its errors land in the same
 * list, since it's the side that writes the file.
 */
export function ThemeImportDialog({
  open,
  onOpenChange,
  profile,
  initialJson,
  intent = "import",
  onImported,
}: ThemeImportDialogProps) {
  const copy = COPY[intent];
  const [json, setJson] = useState(initialJson ?? "");
  const [errors, setErrors] = useState<ThemeValidationError[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setJson(initialJson ?? "");
    setErrors([]);
    setSaving(false);
    setCopied(false);
  }, [open, initialJson]);

  async function handleFile(file: File): Promise<void> {
    if (file.size > MAX_THEME_BYTES) {
      setErrors([{ path: "", message: "arquivo grande demais para um tema (máx. 64 KB)" }]);
      return;
    }
    setJson(await file.text());
    setErrors([]);
  }

  async function handleSubmit(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      setErrors([{ path: "", message: error instanceof Error ? error.message : "JSON inválido" }]);
      return;
    }

    const result = parseTheme(parsed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setSaving(true);
    try {
      const saved = await saveTheme(profile.host, profile.relayPort, result.theme);
      // Optimistic: the next `useThemeSync` pass would pick this up anyway,
      // but that's on foreground/mount, and the theme has to be selectable
      // the moment the dialog closes.
      const current = customThemesForHost(profile.host).filter((theme) => theme.id !== saved.id);
      setThemesForHost(profile.host, [...current, saved]);
      onImported(saved);
      onOpenChange(false);
    } catch (error) {
      setErrors(
        error instanceof ThemeSaveError && error.errors.length > 0
          ? error.errors
          : [{ path: "", message: error instanceof Error ? error.message : String(error) }],
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {copy.hint} O tema fica salvo em {profile.host} e pode ser usado por qualquer perfil desse
            servidor.
          </p>

          <textarea
            value={json}
            onChange={(event) => {
              setJson(event.target.value);
              setErrors([]);
              setCopied(false);
            }}
            spellCheck={false}
            placeholder={'{\n  "version": 1,\n  "id": "meu-tema",\n  "name": "Meu tema",\n  "appearance": "dark",\n  "colors": { "background": "#1e1e1e", … }\n}'}
            className="h-56 w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring"
          />

          {errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 p-2.5">
              {errors.map((error, index) => (
                <li key={`${error.path}-${String(index)}`} className="text-xs text-destructive">
                  {error.path ? <span className="font-mono">{error.path}: </span> : null}
                  {error.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" />
                Escolher arquivo
              </Button>
              {/* Doubles as the export path: opening this dialog from
                  "duplicar" pre-fills it with the whole theme. Clipboard
                  instead of a download link — `download` on an anchor isn't
                  honored across all three webviews, and copying is the
                  gesture that works the same on desktop and on the phone. */}
              <Button
                variant="ghost"
                size="sm"
                disabled={json.trim().length === 0}
                onClick={() => {
                  navigator.clipboard.writeText(json).then(
                    () => setCopied(true),
                    () => setErrors([{ path: "", message: "não foi possível copiar" }]),
                  );
                }}
              >
                <Copy className="size-3.5" />
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button size="sm" disabled={saving || json.trim().length === 0} onClick={() => void handleSubmit()}>
                {saving ? "Salvando…" : copy.submit}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
