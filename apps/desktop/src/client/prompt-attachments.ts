import type {
  AgendaEventValue,
  PromptBridge,
} from "@calendar/core/desktop-bridge";

export const attachmentControls = (
  event: AgendaEventValue,
  api: PromptBridge | undefined
) => {
  const list = document.createElement("div");
  list.className = "prompt-attachments";
  list.dataset.promptAttachments = "";
  const attachments = event.attachments ?? [];

  const controls = attachments.map((attachment, index) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = attachment.title;
    control.title = attachment.title;
    control.setAttribute("aria-label", `Open attachment ${attachment.title}`);
    control.dataset.promptAttachment = String(index);
    control.addEventListener("click", (click) => {
      click.stopPropagation();
      api?.act({
        action: "attachment",
        index,
        key: event.key,
        url: attachment.url,
      });
    });

    return control;
  });

  list.append(...controls.slice(0, 2));

  if (controls.length > 2) {
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = `+${controls.length - 2} more`;
    more.dataset.promptAttachmentsMore = "";
    more.setAttribute("aria-expanded", "false");
    more.addEventListener(
      "click",
      (click) => {
        click.stopPropagation();
        list.dataset.expanded = "true";
        more.setAttribute("aria-expanded", "true");
        list.replaceChildren(...controls);
        controls[2]?.focus();
      },
      { once: true }
    );
    list.append(more);
  }

  return list;
};
