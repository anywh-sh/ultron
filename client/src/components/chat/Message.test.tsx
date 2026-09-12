import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserBubble } from "./Message";
import { en } from "@/i18n/en";

afterEach(() => cleanup());

/**
 * The action strip under a sent message had no test of any kind, and it is
 * where the redesign moved four Portuguese literals into the dictionary. The
 * labels are the whole interface of these buttons — they carry no text —
 * so a label that silently stops matching is a control nobody can name.
 */
function renderBubble(props: Partial<Parameters<typeof UserBubble>[0]> = {}) {
  const onStartEdit = vi.fn();
  const onCopy = vi.fn();
  render(
    <TooltipProvider>
      <UserBubble
        id="m1"
        text="uma mensagem"
        sentAt={Date.now()}
        isEditing={false}
        onStartEdit={onStartEdit}
        onCancelEdit={vi.fn()}
        onSaveEdit={vi.fn()}
        onCopy={onCopy}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onStartEdit, onCopy };
}

describe("UserBubble", () => {
  it("names its actions from the dictionary", () => {
    renderBubble();

    expect(screen.getByRole("button", { name: en.chat.message.copy })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.chat.message.edit })).toBeInTheDocument();
  });

  it("starts an edit with the message's own text", async () => {
    const user = userEvent.setup();
    const { onStartEdit } = renderBubble();

    await user.click(screen.getByRole("button", { name: en.chat.message.edit }));

    expect(onStartEdit).toHaveBeenCalledWith("m1", "uma mensagem");
  });

  it("switches the copy button's label to the confirmation after copying", async () => {
    const user = userEvent.setup();
    const { onCopy } = renderBubble();

    await user.click(screen.getByRole("button", { name: en.chat.message.copy }));

    expect(onCopy).toHaveBeenCalledWith("uma mensagem");
    expect(screen.getByRole("button", { name: en.chat.message.copied })).toBeInTheDocument();
  });

  // Truncating history at a message that carried an image would have to
  // resend the attachment, which the edit path doesn't do — so the button is
  // disabled rather than quietly dropping the image. The tooltip is the only
  // place that says why, and a disabled button gets no pointer events, hence
  // the `span` wrapper it is written with.
  it("explains why editing is unavailable on a message with an attachment", async () => {
    const user = userEvent.setup();
    renderBubble({ images: [{ path: "/tmp/a.png", kind: "image", previewUrl: "blob:a" }] });

    const disabled = screen.getByRole("button", { name: en.chat.message.editUnavailable });
    expect(disabled).toBeDisabled();

    await user.hover(disabled.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(en.chat.message.editWithAttachment);
  });
});
