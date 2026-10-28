import { Effect, Queue, Stream } from "effect";

import { Message } from "../message.js";

export const systemSettingsStream = () =>
  Stream.callback<ReturnType<typeof Message.ReceivedSystemSettings>>((queue) =>
    Effect.gen(function* systemSettingsSubscription() {
      const media = window.matchMedia("(prefers-color-scheme: dark)");

      const publish = () => {
        Queue.offerUnsafe(
          queue,
          Message.ReceivedSystemSettings({
            dark: media.matches,
            hour24:
              Intl.DateTimeFormat(undefined, {
                hour: "numeric",
              }).resolvedOptions().hour12 === false,
            locale: Intl.DateTimeFormat().resolvedOptions().locale,
          })
        );
      };

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          media.addEventListener("change", publish);
          publish();
        }),
        () =>
          Effect.sync(() => {
            media.removeEventListener("change", publish);
          })
      );
    })
  );
