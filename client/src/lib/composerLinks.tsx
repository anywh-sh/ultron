import type { ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { handleExternalLinkClick } from "@/lib/externalLink";

/**
 * Formato de fio (wire) pros links criados via paste-to-link no composer:
 * sintaxe `[texto](url)` — não é markdown genérico, só o que
 * `serializeEditorContent` emite. `renderTextWithLinks` só reconhece esse
 * padrão específico, nunca interpreta markdown arbitrário que o usuário
 * tenha digitado (itálico, cabeçalho, lista etc. continuam texto puro).
 */
const WIRE_LINK_REGEX = /\[([^\]]+)\]\(([a-zA-Z][a-zA-Z\d+.-]*:[^\s)]+)\)/g;

/** Espaço de largura zero que `Composer.tsx` (`hardBreakAnchorPlugin`) injeta
 * como texto real depois de `hardBreak`s consecutivos, só pra dar ao
 * navegador uma caixa de layout válida onde ancorar o cursor (bug real,
 * confirmado via Playwright/Chromium — sem isso o cursor "sobe" uma linha em
 * telas com 2+ quebras seguidas sem texto entre elas). Puramente cosmético,
 * nunca deve sobreviver na mensagem enviada. */
const HARD_BREAK_ANCHOR_REGEX = /​/g;

function serializeInline(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  if (node.type !== "text") return "";
  const text = (node.text ?? "").replace(HARD_BREAK_ANCHOR_REGEX, "");
  const linkMark = node.marks?.find((mark) => mark.type === "link");
  const href = linkMark?.attrs?.href as string | undefined;
  return href ? `[${text}](${href})` : text;
}

function serializeBlock(node: JSONContent): string {
  if (node.type !== "paragraph" || !node.content) return "";
  return node.content.map(serializeInline).join("");
}

/** Serializa o doc do Tiptap (só parágrafo(s) com texto/hardBreak/link,
 * dado o schema restrito do composer) pro texto plano enviado no wire. */
export function serializeEditorContent(doc: JSONContent): string {
  return (doc.content ?? []).map(serializeBlock).join("\n\n");
}

/** Reconstrói os links a partir do texto plano recebido, pra exibir na
 * bolha da mensagem enviada — mesma classe visual `composer-link` do
 * editor, sem depender de um parser markdown completo (evita reinterpretar
 * markdown que o usuário tenha digitado por acaso como texto normal). */
export function renderTextWithLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = new RegExp(WIRE_LINK_REGEX);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [full, label, href] = match;
    nodes.push(
      <a
        key={`link-${key++}`}
        href={href}
        rel="noopener noreferrer"
        className="composer-link"
        onClick={(event) => handleExternalLinkClick(event, href)}
      >
        {label}
      </a>,
    );
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
