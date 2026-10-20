import { Effect, Queue, Stream } from "effect";
import type { Cause } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";

const cancelKeyboard =
  (queue: Queue.Queue<ReturnType<typeof Message.KeyboardClose>, Cause.Done>) =>
  (event: Event): void => {
    if (
      event.target instanceof HTMLDialogElement &&
      event.target.dataset.keyboardDialog === "true"
    ) {
      event.preventDefault();
      Queue.offerUnsafe(queue, Message.KeyboardClose());
    }
  };

export const PrepareKeyboard = Mount.defineStream("PrepareKeyboard", {
  execute: ({ element }) =>
    Stream.callback<ReturnType<typeof Message.KeyboardClose>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          let current: HTMLElement | undefined;
          let previous: HTMLElement | undefined;
          let step: string | undefined;

          const inspect = () => {
            const next =
              element.querySelector<HTMLElement>(
                "#keyboard-command-dialog, #shortcuts-page"
              ) ?? undefined;

            if (current !== next) {
              if (next === undefined) {
                if (previous?.isConnected === true) {
                  previous.focus();
                }
              } else {
                if (current === undefined) {
                  previous =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : undefined;
                }

                if (
                  next instanceof HTMLDialogElement &&
                  !next.open &&
                  next.isConnected
                ) {
                  next.showModal();
                }

                next.querySelector<HTMLInputElement>("input")?.focus();
              }

              current = next;
            }

            const nextStep = next?.dataset.keyboardStep;

            if (nextStep !== step) {
              next?.querySelector<HTMLInputElement>("input")?.focus();
              step = nextStep;
            }

            const selected = element.querySelector<HTMLElement>(
              "#keyboard-choices [aria-selected='true']"
            );

            selected?.scrollIntoView?.({ block: "nearest" });
          };

          const cancel = cancelKeyboard(queue);

          const observer = new MutationObserver(inspect);
          observer.observe(element, {
            attributeFilter: ["aria-selected", "data-keyboard-step"],
            attributes: true,
            childList: true,
            subtree: true,
          });
          element.addEventListener("cancel", cancel, true);
          inspect();

          return { cancel, observer };
        }),
        ({ observer, cancel }) =>
          Effect.sync(() => {
            observer.disconnect();
            element.removeEventListener("cancel", cancel, true);
          })
      )
    ),
  messages: [Message.KeyboardClose],
});
