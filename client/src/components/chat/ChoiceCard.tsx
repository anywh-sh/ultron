import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isIOS } from "@/lib/platform";
import type { ChoiceAnswer, ChoiceQuestion } from "@/lib/relayClient";

interface ChoiceCardProps {
  promptId: string;
  questions: ChoiceQuestion[];
  /** `"approval"` (a live blocked tool call, e.g. permission approve/deny)
   * genuinely needs SOME answer to unblock it — the close button falls back
   * to `onAnswer` with whatever's selected, same as before. `"choice"` (the
   * `present_choice` MCP tool / plan-mode marker) has no live call waiting,
   * so the close button just calls `onClose` and sends nothing — see the
   * `choice_prompt` doc comment in relay-types.ts. */
  kind: "approval" | "choice";
  onAnswer: (answers: ChoiceAnswer[]) => void;
  onClose: () => void;
}

/** Picker for a `present_choice` MCP call blocked
 * mid-turn, styled after Claude Desktop's own `AskUserQuestion` card.
 * Sits right above the
 * composer, replacing the old row of dir/files/terminal buttons there (moved
 * below the composer instead — see ChatPanel.tsx).
 *
 * One `choice_answer` is sent for the WHOLE prompt at once (not per
 * question, see relay/src/sharedSession.ts::answerChoice) — this component
 * accumulates an answer per question locally as the user steps through them
 * and only calls `onAnswer` once the last one is confirmed or skipped, or
 * (for `kind: "approval"` only) the user closes the card early, filling in
 * whatever wasn't reached yet with an empty selection so the live blocked
 * tool call always genuinely unblocks. `kind: "choice"` closes with no
 * `onAnswer` call at all instead — see `ChoiceCardProps.kind`. */
export function ChoiceCard({ promptId, questions, kind, onAnswer, onClose }: ChoiceCardProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string[]>>(new Map());
  const [selected, setSelected] = useState<string[]>([]);
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(new Map());
  const [customText, setCustomText] = useState("");

  // A fresh prompt (new `promptId`) always starts over — same instance can
  // be reused across prompts since `ChatPanel` keys it by `choicePrompt`
  // state, not by mount/unmount.
  useEffect(() => {
    setIndex(0);
    setAnswers(new Map());
    setSelected([]);
    setCustomTexts(new Map());
    setCustomText("");
  }, [promptId]);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  // Free text always wins over checked options when both are present — kept
  // mutually exclusive (see `toggleOption`/`setCustomTextFor`) so there's
  // never an ambiguous "which one did they mean" at confirm time.
  const effectiveSelection = customText.trim() ? [customText.trim()] : selected;

  function goTo(nextIndex: number): void {
    setIndex(nextIndex);
    setSelected(answers.get(nextIndex) ?? []);
    setCustomText(customTexts.get(nextIndex) ?? "");
  }

  function toggleOption(label: string): void {
    setCustomText("");
    setCustomTexts((current) => {
      const next = new Map(current);
      next.delete(index);
      return next;
    });
    if (question.multiSelect) {
      setSelected((current) => (current.includes(label) ? current.filter((item) => item !== label) : [...current, label]));
    } else {
      setSelected((current) => (current.includes(label) ? [] : [label]));
    }
  }

  function setCustomTextFor(value: string): void {
    setCustomText(value);
    setCustomTexts((current) => new Map(current).set(index, value));
    if (value.trim() && selected.length > 0) setSelected([]);
  }

  function finish(finalAnswers: Map<number, string[]>): void {
    onAnswer(questions.map((question, questionIndex) => ({ question: question.question, selected: finalAnswers.get(questionIndex) ?? [] })));
  }

  function confirmCurrent(withSelection: string[]): void {
    const next = new Map(answers).set(index, withSelection);
    if (isLast) {
      finish(next);
      return;
    }
    setAnswers(next);
    goTo(index + 1);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-3",
        // On iOS the parent stack already provides horizontal padding + gap
        // between siblings — an extra margin here would misalign
        // this card against the composer/edit-warning next to it.
        isIOS() ? "shrink-0" : "mx-3 mt-3",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          {question.header && <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{question.header}</p>}
          <p className="text-sm font-medium text-foreground">{question.question}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {questions.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                aria-label="Pergunta anterior"
                className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-1 text-xs text-muted-foreground">
                {index + 1} de {questions.length}
              </span>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={isLast}
                aria-label="Próxima pergunta"
                className="cursor-pointer text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => (kind === "approval" ? finish(new Map(answers).set(index, effectiveSelection)) : onClose())}
            aria-label={kind === "approval" ? "Fechar e responder com o que já foi selecionado" : "Fechar sem responder"}
            className="ml-1 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className={cn("flex flex-col divide-y divide-border", customText.trim() && "opacity-40")}>
        {question.options.map((option) => {
          const isSelected = selected.includes(option.label);
          return (
            <button
              type="button"
              key={option.label}
              onClick={() => toggleOption(option.label)}
              className="flex cursor-pointer items-center gap-2.5 py-2 text-left"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border",
                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                <Check className={cn("size-3", !isSelected && "opacity-0")} />
              </span>
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{option.label}</span>
                {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* Free-text fallback — always the last option, only for `present_choice`/
          plan-marker prompts. Not offered for `kind: "approval"`: that path
          checks `selected` against the literal "Aprovar"/"Recusar" labels
          (sharedSession.ts::checkPermission), so free text there would never
          match and could stall the live blocked tool call. */}
      {kind === "choice" && (
        <input
          type="text"
          value={customText}
          onChange={(event) => setCustomTextFor(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && customText.trim()) confirmCurrent([customText.trim()]);
          }}
          placeholder="Ou escreva sua própria resposta…"
          aria-label="Escrever uma resposta personalizada"
          className="min-w-0 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {customText.trim() ? "resposta personalizada" : `${selected.length} selecionado(s)`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => confirmCurrent([])}>
            Pular
          </Button>
          <Button
            type="button"
            size="icon-sm"
            onClick={() => confirmCurrent(effectiveSelection)}
            aria-label={isLast ? "Enviar respostas" : "Próxima pergunta"}
          >
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
