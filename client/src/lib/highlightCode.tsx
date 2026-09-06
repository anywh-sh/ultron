import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { createLowlight, common } from "lowlight";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";

// Same engine (lowlight/hast, on top of highlight.js) that `AssistantText`
// already uses via `rehype-highlight` for markdown code blocks — reuses the
// `.hljs-*` theme from `index.css`, without needing to go through the
// markdown parser (here the input is a diff/file's raw content, not the
// agent's text).
const lowlight = createLowlight(common);

/** Colors a code line/snippet according to the detected language (see
 * `codeLanguage.ts`). Falls back to plain text if the language isn't
 * recognized or the parser fails on a malformed snippet — highlighting is
 * cosmetic, it can never break the card's rendering. */
export function highlightCode(language: string, code: string): ReactNode {
  const lang = lowlight.registered(language) ? language : "plaintext";
  try {
    const tree = lowlight.highlight(lang, code);
    return toJsxRuntime(tree, { Fragment, jsx, jsxs });
  } catch {
    return code;
  }
}
