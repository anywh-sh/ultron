import { memo } from "react";
import { useDict } from "@/i18n";

/** A turn that failed. Framed like the tool call above it rather than left
 * as loose red text — in a log made of bordered cards, unframed text read
 * as part of the assistant's own answer. */
export const ErrorMessage = memo(function ErrorMessage({ message }: { message: string }) {
  const dict = useDict();
  return (
    <p className="border border-destructive/40 bg-card px-2.5 py-2 text-xs text-destructive">
      {dict.chat.log.error.replace("{message}", message)}
    </p>
  );
});
