import { Menu, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileTopBarProps {
  title: string;
  connected: boolean;
  onOpenDrawer: () => void;
  onNewConversation: () => void;
}

/**
 * Topo da tela no iOS (docs/24, v2 — corrigindo a v1 depois de comparar com
 * o app Claude real): nada de barra/pílula com fundo próprio. Em vez disso:
 *
 * - Uma zona de blur progressivo (`backdrop-blur` com `mask-image` em
 *   gradiente) atrás de tudo, puramente decorativa (`pointer-events-none`)
 *   — o log de mensagens continua rolando por baixo, ficando desfocado
 *   conforme se aproxima do topo, em vez de sumir atrás de um retângulo
 *   opaco.
 * - Título + status da sessão são texto puro sobre essa zona, sem pílula
 *   própria.
 * - Menu e "+" são círculos glass INDEPENDENTES (não uma barra só) — assim
 *   como no app Claude de referência.
 */
export function MobileTopBar({ title, connected, onOpenDrawer, onNewConversation }: MobileTopBarProps) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-20 backdrop-blur-lg"
        style={{
          height: "calc(env(safe-area-inset-top) + 92px)",
          maskImage: "linear-gradient(to bottom, black 0%, black 45%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 45%, transparent 100%)",
        }}
      />

      <div
        className="absolute inset-x-4 z-30 flex items-center justify-between"
        style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Abrir sessões"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/8 bg-bg-elevated/50 text-foreground shadow-lg backdrop-blur-xl backdrop-saturate-150 transition-colors active:bg-white/10"
        >
          <Menu className="size-4.5" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2">
          <span className="w-full truncate text-center text-[15px] font-semibold">{title}</span>
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
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/8 bg-bg-elevated/50 text-foreground shadow-lg backdrop-blur-xl backdrop-saturate-150 transition-colors active:bg-white/10"
        >
          <Plus className="size-4.5" />
        </button>
      </div>
    </>
  );
}
