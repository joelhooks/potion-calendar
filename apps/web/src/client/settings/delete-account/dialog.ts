import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../../message.js";
import { AccountDeletionChange } from "./model.js";

const stopEscape = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    event.stopPropagation();
  }
};

export const attachAccountDeletionDialog = (
  dialog: HTMLDialogElement,
  cancelIntent: () => void
) => {
  const cancel = (event: Event): void => {
    if (event.target === dialog) {
      event.preventDefault();
      event.stopPropagation();
      cancelIntent();
    }
  };

  dialog.addEventListener("keydown", stopEscape, true);
  dialog.addEventListener("cancel", cancel);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>("#delete-account-cancel")?.focus();

  return () => {
    dialog.removeEventListener("keydown", stopEscape, true);
    dialog.removeEventListener("cancel", cancel);

    if (dialog.open) {
      dialog.close();
    }
  };
};

export const PrepareAccountDeletionDialog = Mount.defineStream(
  "PrepareAccountDeletionDialog",
  {
    args: { personId: Schema.String },
    execute: ({ element, personId }) =>
      Stream.callback<
        | ReturnType<typeof Message.AccountDeletionDialogReady>
        | ReturnType<typeof Message.ChangedAccountDeletion>
      >((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            if (!(element instanceof HTMLDialogElement)) {
              throw new Error("Account deletion mount requires a dialog");
            }

            const dispose = attachAccountDeletionDialog(element, () => {
              Queue.offerUnsafe(
                queue,
                Message.ChangedAccountDeletion({
                  change: AccountDeletionChange.cases.Cancel.make({}),
                  personId,
                })
              );
            });

            Queue.offerUnsafe(queue, Message.AccountDeletionDialogReady());

            return dispose;
          }),
          (dispose) => Effect.sync(dispose)
        )
      ),
    messages: [
      Message.AccountDeletionDialogReady,
      Message.ChangedAccountDeletion,
    ],
  }
);
