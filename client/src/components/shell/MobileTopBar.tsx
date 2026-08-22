import { Menu, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileTopBarProps {
  title: string;
  connected: boolean;
  onOpenDrawer: () => void;
  onNewConversation: () => void;
}

/**
 * Barra superior consolidada do iOS (docs/24) — menu, título/status da
 * sessão ativa e "+ nova conversa" numa peça só, substituindo a cápsula de
 * conexão solta (Fase E) que não tinha nenhum contexto de sessão.
 *
 * Hoje é glass via CSS (`backdrop-filter`) — candidata a virar glass nativo
 * Swift de verdade (mesmo material da cápsula), mantendo esta mesma árvore
 * React/interação por cima de uma webview transparente ali. Ver
 * `tauri-plugin-native-chrome` pro lado nativo.
 */
export function MobileTopBar({ title, connected, onOpenDrawer, onNewConversation }: MobileTopBarProps) {
  return (
    <div
      className="absolute inset-x-4 z-30"
      style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
    >
      <div className="flex h-13 items-center gap-1 rounded-full border border-white/8 bg-bg-elevated/70 px-1.5 shadow-lg backdrop-blur-xl backdrop-saturate-150">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Abrir sessões"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors active:bg-white/10"
        >
          <Menu className="size-4.5" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <span className="w-full truncate text-center text-[14.5px] font-semibold">{title}</span>
          <span
            className={cn(
              "flex items-center gap-1.5 font-mono text-[11.5px]",
              connected ? "text-muted-foreground" : "text-destructive",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-muted-foreground" : "animate-pulse bg-destructive",
              )}
            />
            {connected ? "Conectado" : "Reconectando…"}
          </span>
        </div>

        <button
          type="button"
          onClick={onNewConversation}
          aria-label="Nova conversa"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors active:bg-white/10"
        >
          <Plus className="size-4.5" />
        </button>
      </div>
    </div>
  );
}
