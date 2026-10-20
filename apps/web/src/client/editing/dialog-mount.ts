import { Effect, Option, Queue, Schema, Stream } from "effect";
import type { Cause } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { EditorAction } from "./editor-action.js";

const cancelDialog =
  (
    queue: Queue.Queue<ReturnType<typeof Message.EditingAction>, Cause.Done>,
    person: Option.Option<string>
  ) =>
  (event: Event): void => {
    if (
      event.target instanceof HTMLDialogElement &&
      event.target.dataset.editingDialog === "true"
    ) {
      event.preventDefault();
      Queue.offerUnsafe(
        queue,
        Message.EditingAction({
          action: EditorAction.cases.Cancel.make({}),
          personId: Option.getOrUndefined(person),
        })
      );
    }
  };

export const PrepareEditingDialogs = Mount.defineStream(
  "PrepareEditingDialogs",
  {
    args: { person: Schema.Option(Schema.String) },
    execute: ({ element, person }) =>
      Stream.callback<ReturnType<typeof Message.EditingAction>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const openDialogs = () => {
              for (const dialog of element.querySelectorAll<HTMLDialogElement>(
                "dialog[data-editing-dialog]"
              )) {
                if (!dialog.open && dialog.isConnected) {
                  dialog.showModal();
                  const id = dialog.dataset.initialFocus;

                  if (id !== undefined) {
                    element.querySelector<HTMLElement>(`#${id}`)?.focus();
                  }
                }
              }
            };

            const cancel = cancelDialog(queue, person);

            const observer = new MutationObserver(openDialogs);
            observer.observe(element, { childList: true, subtree: true });
            element.addEventListener("cancel", cancel, true);
            openDialogs();

            return { cancel, observer };
          }),
          (resource) =>
            Effect.sync(() => {
              resource.observer.disconnect();
              element.removeEventListener("cancel", resource.cancel, true);
            })
        )
      ),
    messages: [Message.EditingAction],
  }
);
