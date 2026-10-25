import { Effect, Stream } from "effect";

import type { AppMessage } from "../../message.js";

const preventProfileUnload = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
};

export const profileUnloadStream = (
  dirty: boolean
): Stream.Stream<AppMessage> =>
  dirty
    ? Stream.callback<AppMessage>(() =>
        Effect.acquireRelease(
          Effect.sync(() => {
            window.addEventListener("beforeunload", preventProfileUnload);
          }),
          () =>
            Effect.sync(() => {
              window.removeEventListener("beforeunload", preventProfileUnload);
            })
        ).pipe(Effect.andThen(Effect.never))
      )
    : Stream.empty;
