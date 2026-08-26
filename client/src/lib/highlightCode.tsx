import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { createLowlight, common } from "lowlight";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";

// Mesma engine (lowlight/hast, sobre highlight.js) que o `AssistantText` já
// usa via `rehype-highlight` pros blocos de código do markdown — reutiliza o
// tema `.hljs-*` de `index.css`, sem precisar passar pelo parser de markdown
// (aqui a entrada é o conteúdo cru de um diff/arquivo, não texto do agente).
const lowlight = createLowlight(common);

/** Colore uma linha/trecho de código de acordo com a linguagem detectada
 * (ver `codeLanguage.ts`). Cai pra texto puro se a linguagem não é
 * reconhecida ou o parser falhar num trecho malformado — highlight é
 * cosmético, nunca pode quebrar a renderização do card. */
export function highlightCode(language: string, code: string): ReactNode {
  const lang = lowlight.registered(language) ? language : "plaintext";
  try {
    const tree = lowlight.highlight(lang, code);
    return toJsxRuntime(tree, { Fragment, jsx, jsxs });
  } catch {
    return code;
  }
}
