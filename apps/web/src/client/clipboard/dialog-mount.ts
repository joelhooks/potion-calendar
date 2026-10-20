import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { ClipboardAction } from "./runtime.js";

const cancelClipboardDialog =
  (send: (intentId: string) => void) => (event: Event) => {
    if (
      event.target instanceof HTMLDialogElement &&
      event.target.dataset.clipboardDialog !== undefined
    ) {
      event.preventDefault();
      send(event.target.dataset.clipboardDialog);
    }
  };

export const PrepareClipboardDialogs = Mount.defineStream(
  "PrepareClipboardDialogs",
  {
    args: { personId: Schema.String, sessionId: Schema.String },
    execute: ({ element, personId, sessionId }) =>
      Stream.callback<ReturnType<typeof Message.ClipboardAction>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const open = () => {
              for (const dialog of element.querySelectorAll<HTMLDialogElement>(
                "dialog[data-clipboard-dialog]"
              )) {
                if (!dialog.open && dialog.isConnected) {
                  dialog.showModal();
                  element
                    .querySelector<HTMLElement>("#clipboard-exclude")
                    ?.focus();
                }
              }
            };

            const cancel = cancelClipboardDialog((intentId) => {
              Queue.offerUnsafe(
                queue,
                Message.ClipboardAction({
                  action: ClipboardAction.cases.Cancel.make({ intentId }),
                  personId,
                  sessionId,
                })
              );
            });

            const observer = new MutationObserver(open);
            observer.observe(element, { childList: true, subtree: true });
            element.addEventListener("cancel", cancel, true);
            open();

            return { cancel, observer };
          }),
          ({ cancel, observer }) =>
            Effect.sync(() => {
              observer.disconnect();
              element.removeEventListener("cancel", cancel, true);
            })
        )
      ),
    messages: [Message.ClipboardAction],
  }
);
