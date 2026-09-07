import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import { applyCachedTheme } from "@/lib/themeApply";
import "./index.css";

// Before the first render, never inside a component: the profile's theme
// lives on the relay, so without a local cache every cold start would paint
// the built-in theme, mount, sync, and repaint.
applyCachedTheme();

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
