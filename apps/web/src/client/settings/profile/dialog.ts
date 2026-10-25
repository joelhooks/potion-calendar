import { Effect } from "effect";
import { Mount } from "foldkit";

import { Message } from "../../message.js";

const stopProfileEscape = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    event.stopPropagation();
  }
};

export const PrepareProfileDiscard = Mount.define("PrepareProfileDiscard", {
  execute: ({ element }) =>
    Effect.gen(function* prepareProfileDiscard() {
      if (!(element instanceof HTMLDialogElement)) {
        return yield* Effect.die(
          new Error("Profile discard mount requires a dialog")
        );
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          element.addEventListener("keydown", stopProfileEscape, true);
          element.showModal();
          element
            .querySelector<HTMLButtonElement>("#profile-continue")
            ?.focus();

          return { dialog: element };
        }),
        ({ dialog }) =>
          Effect.sync(() => {
            dialog.removeEventListener("keydown", stopProfileEscape, true);

            if (dialog.open) {
              dialog.close();
            }
          })
      );

      return Message.ProfileDialogReady();
    }),
  messages: [Message.ProfileDialogReady],
});
