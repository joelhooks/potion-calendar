import { Effect } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";

const stopRemovalEscape = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    event.stopPropagation();
  }
};

export const PrepareAccountRemoval = Mount.define("PrepareAccountRemoval", {
  execute: ({ element }) =>
    Effect.gen(function* prepareAccountRemoval() {
      if (!(element instanceof HTMLDialogElement)) {
        return yield* Effect.die(
          new Error("Account removal mount requires a dialog")
        );
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          element.addEventListener("keydown", stopRemovalEscape, true);
          element.showModal();
          element
            .querySelector<HTMLButtonElement>("#settings-removal-cancel")
            ?.focus();

          return { dialog: element, escape: stopRemovalEscape };
        }),
        ({ dialog, escape }) =>
          Effect.sync(() => {
            dialog.removeEventListener("keydown", escape, true);

            if (dialog.open) {
              dialog.close();
            }
          })
      );

      return Message.Navigated();
    }),
  messages: [Message.Navigated],
});
