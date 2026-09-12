import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 500,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // `bg-sidebar` (not `bg-popover`, like dropdown/popover) on purpose
          // — a tooltip needs to stand out from anything behind it,
          // including another element right next to it that already uses
          // `bg-popover`/`bg-elevated` (real finding: the slash commands
          // menu's tooltip was almost invisible next to the listing itself,
          // same color).
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in border border-border bg-sidebar px-2.5 py-1.5 font-mono text-[11px] text-balance text-popover-foreground shadow-popover fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 bg-sidebar fill-sidebar" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

function TooltipShortcut({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 opacity-60">{children}</span>
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipShortcut }
