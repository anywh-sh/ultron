import { useState } from "react";
import { Code2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { CodeFileView } from "@/components/files/CodeFileView";

interface MarkdownFileViewProps {
  path: string;
  content: string;
  truncated: boolean;
}

// `react-markdown` doesn't virtualize — formatting something this big would
// freeze the webview, so above this size the raw (virtualized) source opens
// by default, with a button to force the formatted view anyway.
const LARGE_MARKDOWN_BYTES = 200 * 1024;

/**
 * `.md` viewer — formatted by default (decision 7, docs/41), with a toggle
 * to the raw source in the header. Reuses `MarkdownContent`, the same
 * renderer the chat uses for the agent's own markdown, so a file looks
 * identical whether the agent shows it inline or the user opens it here.
 */
export function MarkdownFileView({ path, content, truncated }: MarkdownFileViewProps) {
  const [showRaw, setShowRaw] = useState(content.length > LARGE_MARKDOWN_BYTES);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-border-soft px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowRaw((current) => !current)}
              aria-label={showRaw ? "Ver formatado" : "Ver código-fonte"}
            >
              {showRaw ? <FileText className="size-3.5" /> : <Code2 className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{showRaw ? "Ver formatado" : "Ver código-fonte"}</TooltipContent>
        </Tooltip>
      </div>
      {truncated && (
        <div className="shrink-0 border-b border-border-soft bg-bg-elevated px-3 py-1 text-xs text-muted-foreground">
          Arquivo grande — mostrando só o início.
        </div>
      )}
      <div className="min-h-0 flex-1">
        {showRaw ? (
          <CodeFileView path={path} content={content} />
        ) : (
          <div className="scrollbar-thin prose-chat h-full overflow-auto p-4 text-sm text-foreground">
            <MarkdownContent text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
