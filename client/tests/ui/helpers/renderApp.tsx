import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "@/App";

/** Mirrors the production wrapper in client/src/main.tsx (TooltipProvider is
 * required by every Tooltip-using component, including Sidebar's "Nova
 * conversa" button) — `<App />` alone throws. `StrictMode` is left out on
 * purpose: its dev-only mount/unmount/remount would double every effect,
 * including the one that opens the relay WebSocket, which the fake relay
 * harness doesn't need to handle for this tier's current scope. */
export function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
}
