import { PromptSoundRequest, promptWire } from "@calendar/core/desktop-bridge";
import type { PlayablePromptSound } from "@calendar/core/desktop-bridge";
import { Deferred, Effect, Option, Schema } from "effect";

import { DesktopError } from "./config.js";

export interface PromptSoundPort {
  readonly send: (request: typeof PromptSoundRequest.Type) => void;
  readonly subscribe: (receive: (message: string) => void) => () => void;
}

export const preparePromptSound = Effect.fn("Desktop.preparePromptSound")(
  function* preparePromptSound(
    port: PromptSoundPort,
    request: number,
    sound: typeof PlayablePromptSound.Type
  ) {
    const ready = yield* Deferred.make<boolean, DesktopError>();
    const context = yield* Effect.context();
    const runSync = Effect.runSyncWith(context);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        port.subscribe((message) => {
          const reply = Schema.decodeOption(promptWire.soundReply)(message);

          if (
            Option.isSome(reply) &&
            reply.value.request === request &&
            reply.value.phase === "load"
          ) {
            runSync(
              reply.value.ready
                ? Deferred.succeed(ready, true)
                : Deferred.fail(
                    ready,
                    new DesktopError({
                      message: "Meeting sound could not load",
                    })
                  )
            );
          }
        })
      ),
      (stop) => Effect.sync(stop)
    );
    yield* Effect.sync(() => {
      port.send(PromptSoundRequest.cases.Load.make({ request, sound }));
    });

    return yield* Deferred.await(ready).pipe(
      Effect.asVoid,
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          port.send(PromptSoundRequest.cases.Cancel.make({ request }));
        })
      )
    );
  },
  Effect.scoped
);
