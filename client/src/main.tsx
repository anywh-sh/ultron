import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import { applyFontSize, readFontSize } from "@/lib/fontSize";
import { applyCachedTheme } from "@/lib/themeApply";
import "./index.css";

// Before the first render, never inside a component: the profile's theme
// lives on the relay, so without a local cache every cold start would paint
// the built-in theme, mount, sync, and repaint.
applyCachedTheme();
// Font size is device-local (no relay round trip), but still applied here
// rather than in a component's effect — otherwise the first frame paints at
// the default size and snaps to the stored one a tick later.
applyFontSize(readFontSize());

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("#app not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
