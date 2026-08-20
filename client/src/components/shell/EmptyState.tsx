import { useState } from "react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  /** "new" = veio de "+ Nova conversa"; "switch" = trocou de perfil sem sessão selecionada. */
  variant: "new" | "switch";
  /**
   * Só usado no variant "new" — nome da sessão a criar. Estopgap da Fase 3
   * (stub de chat, sem composer ainda); a Fase 4 substitui isso por criação
   * implícita ao mandar a primeira mensagem.
   */
  onCreateSession?: (name: string) => void;
}

const COPY: Record<EmptyStateProps["variant"], { title: string; body: string }> = {
  new: {
    title: "Nova conversa",
    body: "Digite uma mensagem, anexe uma imagem ou grave um áudio pra começar.",
  },
  switch: {
    title: "Escolha uma conversa",
    body: "Selecione uma sessão na barra lateral, ou comece uma nova.",
  },
};

export function EmptyState({ variant, onCreateSession }: EmptyStateProps) {
  const copy = COPY[variant];
  const [name, setName] = useState("");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="animate-cursor-blink font-mono text-3xl text-text-faint">▍</span>
      <h2 className="text-lg font-medium text-foreground">{copy.title}</h2>
      <p className="max-w-xs text-sm text-muted-foreground">{copy.body}</p>

      {variant === "new" && onCreateSession && (
        <form
          className="mt-2 flex w-full max-w-xs gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            onCreateSession(trimmed);
            setName("");
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="nome da sessão (ex: projeto-x)"
            className="flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ring"
          />
          <Button type="submit" size="sm">
            Criar
          </Button>
        </form>
      )}
    </div>
  );
}
