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

/** Caractere de largura zero que `Composer.tsx` (`hardBreakAnchorPlugin`)
 * injeta como texto real depois de `hardBreak`s consecutivos, só pra dar ao
 * navegador uma caixa de layout válida onde ancorar o cursor (bug real,
 * confirmado via Playwright/Chromium — sem isso o cursor "sobe" uma linha em
 * telas com 2+ quebras seguidas sem texto entre elas). Puramente cosmético,
 * nunca deve sobreviver na mensagem enviada. `U+FEFF` (zero-width no-break
 * space, mesma escolha do Slate.js pro mesmo problema) em vez de `U+200B`
 * (zero-width space) — não porque um funcionasse e o outro não (testado no
 * Simulator iOS, docs/34 item 3: nenhum dos dois sozinho resolvia; a causa
 * raiz de verdade era outra, ver `Composer.tsx`), mas por ser a opção mais
 * testada em outros editores pra esse tipo de âncora. Exportado (não só
 * local) porque `Composer.tsx` precisa do mesmo caractere pra inserir a
 * âncora — duplicar o literal nos dois arquivos é como esse bug escapou
 * despercebido da primeira vez. */
export const HARD_BREAK_ANCHOR = "﻿";
const HARD_BREAK_ANCHOR_REGEX = new RegExp(HARD_BREAK_ANCHOR, "g");

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
