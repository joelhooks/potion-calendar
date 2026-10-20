import { DateTime, Effect, Option, Queue, Stream } from "effect";
import type { Cause } from "effect";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { observeKeyboard } from "./input.js";

type KeyboardQueue = Queue.Queue<AppMessage, Cause.Done>;

const onKeydown =
  (model: AppModel, queue: KeyboardQueue) =>
  (event: KeyboardEvent): void => {
    const message = observeKeyboard(
      model,
      event,
      DateTime.toEpochMillis(DateTime.nowUnsafe())
    );

    if (Option.isSome(message)) {
      Queue.offerUnsafe(queue, message.value);
    }
  };

const onFocus = (model: AppModel, queue: KeyboardQueue) => (): void => {
  if (model.keyboard.prefix !== "") {
    Queue.offerUnsafe(queue, Message.KeyboardResetSequence());
  }
};

export const keyboardStream = (model: AppModel) =>
  Stream.callback<AppMessage>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const keydown = onKeydown(model, queue);
        const focusin = onFocus(model, queue);
        window.addEventListener("keydown", keydown);
        window.addEventListener("focusin", focusin);

        return { focusin, keydown };
      }),
      ({ focusin, keydown }) =>
        Effect.sync(() => {
          window.removeEventListener("keydown", keydown);
          window.removeEventListener("focusin", focusin);
        })
    )
  );
