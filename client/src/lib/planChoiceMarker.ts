// docs/46 — plan mode's `present_choice` fallback marks a genuinely closed
// question inside its own response text (`>>>QUESTION: ... >>>END`, see
// relay/src/planChoiceMarker.ts for the format and why it exists instead of
// a real tool call). The relay parses that same block into a
// `choice_prompt` that renders as a proper `ChoiceCard` — this strips the
// raw marker out of the displayed message text so the human doesn't also
// see the sentinel syntax underneath the card.
//
// Note: only strips a COMPLETE block. While a response is still streaming,
// an opened `>>>QUESTION:` with no closing `>>>END` yet is briefly visible
// as raw text, then disappears once the closing marker arrives — a cosmetic
// rough edge of relying on streamed text, not a bug.
const MARKER_REGEX = />>>QUESTION:[\s\S]*?>>>END\s*/g;

export function stripPlanChoiceMarkers(text: string): string {
  return text.replace(MARKER_REGEX, "").trimEnd();
}
