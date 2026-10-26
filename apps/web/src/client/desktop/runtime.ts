import { watchActor } from "@calendar/capability/actor-watch";
import { DesktopAction, DesktopSettings } from "@calendar/core/desktop-bridge";
import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import {
  Effect,
  Match,
  Option,
  Predicate,
  Queue,
  Schema,
  Stream,
} from "effect";

import {
  previewDesktopSound,
  readDesktopSettings,
  saveDesktopPreferences,
  setDesktopStartup,
} from "./io.js";
import { DesktopNotice, DesktopOutcome } from "./model.js";
import type { DesktopRequest } from "./model.js";

export const runDesktopRequest = Effect.fn("Desktop.runBrowserRequest")(
  function* runDesktopRequest(
    request: typeof DesktopRequest.Type,
    bridge: Option.Option<DesktopBridge>
  ) {
    const logic = createEffectLogic({
      effect: ({
        input,
      }: {
        readonly input: typeof DesktopRequest.Type;
      }): Effect.Effect<typeof DesktopOutcome.Type> =>
        Option.match(bridge, {
          onNone: () =>
            Effect.succeed(DesktopOutcome.cases.Unavailable.make({})),
          onSome: (native) =>
            Match.value(input).pipe(
              Match.tagsExhaustive({
                Read: () =>
                  readDesktopSettings(native).pipe(
                    Effect.map((settings) =>
                      DesktopOutcome.cases.Ready.make({
                        error: Option.none(),
                        settings,
                      })
                    )
                  ),
                Save: (value) =>
                  saveDesktopPreferences(native, value.preferences).pipe(
                    Effect.tap((reply) =>
                      value.previewSound === true &&
                      reply.settings.preferences.promptSound ===
                        value.preferences.promptSound
                        ? previewDesktopSound(
                            native,
                            value.preferences.promptSound
                          )
                        : Effect.void
                    ),
                    Effect.map((reply) =>
                      DesktopOutcome.cases.Ready.make({
                        error: Option.fromNullishOr(reply.error),
                        settings: reply.settings,
                      })
                    )
                  ),
                Startup: (value) =>
                  setDesktopStartup(native, value.enabled).pipe(
                    Effect.map((reply) =>
                      DesktopOutcome.cases.Ready.make({
                        error: Option.fromNullishOr(reply.error),
                        settings: reply.settings,
                      })
                    )
                  ),
              }),
              // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This is Effect's typed failure recovery, not a native callback.
              Effect.orElseSucceed((error) =>
                DesktopOutcome.cases.Failed.make({ message: error.message })
              )
            ),
        }),
    });

    const actor = yield* createEffectActor(logic, { input: request });
    yield* watchActor("desktopSettings", actor);
    const outcome = yield* join(actor).pipe(Effect.orDie);

    return DesktopNotice.cases.Finished.make({
      canSaveIcs: Option.exists(bridge, (native) =>
        Predicate.isFunction(native.saveIcs)
      ),
      outcome,
      request: request.request,
    });
  },
  Effect.scoped
);

export const desktopNoticeStream = (
  bridge: Option.Option<DesktopBridge>
): Stream.Stream<typeof DesktopNotice.Type> =>
  Option.match(bridge, {
    onNone: () => Stream.empty,
    onSome: (native) =>
      Stream.callback<typeof DesktopNotice.Type>((queue) =>
        Effect.gen(function* nativeObserver() {
          const rejected = DesktopNotice.cases.Rejected.make({
            message: "A desktop message was rejected.",
          });

          yield* Effect.acquireRelease(
            Effect.sync(() =>
              native.onAction((value) => {
                const action = Schema.decodeOption(DesktopAction)(value);

                if (Option.isSome(action)) {
                  Queue.offerUnsafe(
                    queue,
                    DesktopNotice.cases.Action.make({ action: action.value })
                  );
                } else {
                  Queue.offerUnsafe(queue, rejected);
                }
              })
            ),
            (stop) => Effect.sync(stop)
          );
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              native.onSettings((value) => {
                const settings = Schema.decodeOption(DesktopSettings)(value);

                if (Option.isSome(settings)) {
                  Queue.offerUnsafe(
                    queue,
                    DesktopNotice.cases.Settings.make({
                      settings: settings.value,
                    })
                  );
                } else {
                  Queue.offerUnsafe(queue, rejected);
                }
              })
            ),
            (stop) => Effect.sync(stop)
          );

          return yield* Effect.never;
        })
      ),
  });
