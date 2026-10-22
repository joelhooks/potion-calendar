import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { TimeZoneAction } from "../time-zones/model.js";
import { bindZoneDrag } from "./events.js";
import { zoneDragMachine } from "./machine.js";

type ZoneDragMessage =
  | ReturnType<typeof Message.PreparedZoneDragHost>
  | ReturnType<typeof Message.PreviewedZoneDrag>
  | ReturnType<typeof Message.TimeZoneAction>;

export const PrepareZoneDrag = Mount.defineStream("PrepareZoneDrag", {
  args: { scopeKey: Schema.String },
  execute: ({ element, viewStateChanges }) =>
    viewStateChanges.pipe(
      Stream.changes,
      Stream.switchMap((state) =>
        state === "Paused"
          ? Stream.fromIterable(
              element instanceof HTMLElement &&
                element.dataset.zoneDragHostKey !== undefined
                ? [
                    Message.PreviewedZoneDrag({
                      hostKey: element.dataset.zoneDragHostKey,
                      preview: Option.none(),
                    }),
                  ]
                : []
            )
          : Stream.callback<ZoneDragMessage>((queue) =>
              Effect.gen(function* prepareZoneDrag() {
                if (!(element instanceof HTMLElement)) {
                  return;
                }

                const actor = yield* createEffectActor(zoneDragMachine, {
                  input: { ids: [] },
                });

                yield* watchActor("calendar.time-zone.header-drag", actor);
                let completed = 0;

                element.dataset.zoneDragPhase = "idle";
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    Reflect.deleteProperty(element.dataset, "zoneDragPhase");
                  })
                );

                if (element.dataset.zoneDragHostKey !== undefined) {
                  Queue.offerUnsafe(
                    queue,
                    Message.PreviewedZoneDrag({
                      hostKey: element.dataset.zoneDragHostKey,
                      preview: Option.none(),
                    })
                  );
                }

                yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    actor.subscribe((snapshot) => {
                      element.dataset.zoneDragPhase = snapshot.value;
                      const { hostKey } = snapshot.context;

                      if (hostKey === "") {
                        return;
                      }

                      Queue.offerUnsafe(
                        queue,
                        Message.PreviewedZoneDrag({
                          hostKey,
                          preview: snapshot.context.preview,
                        })
                      );
                      const result = snapshot.context.completed;

                      if (
                        Option.isSome(result) &&
                        result.value.sequence > completed
                      ) {
                        completed = result.value.sequence;
                        Queue.offerUnsafe(
                          queue,
                          Message.TimeZoneAction({
                            action: TimeZoneAction.cases.MoveTo.make({
                              hostKey,
                              id: result.value.id,
                              index: result.value.index,
                            }),
                          })
                        );
                      }
                    })
                  ),
                  (subscription) =>
                    Effect.sync(() => {
                      subscription.unsubscribe();
                    })
                );
                yield* Effect.acquireRelease(
                  Effect.sync(() => bindZoneDrag({ actor, root: element })),
                  (release) => Effect.sync(release)
                );
                Queue.offerUnsafe(
                  queue,
                  Message.PreparedZoneDragHost({
                    hostKey: element.dataset.zoneDragHostKey ?? "",
                  })
                );
              })
            )
      )
    ),
  messages: [
    Message.PreparedZoneDragHost,
    Message.PreviewedZoneDrag,
    Message.TimeZoneAction,
  ],
});
