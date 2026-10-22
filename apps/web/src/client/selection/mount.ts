import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { bindSelectionEvents } from "./events.js";
import { rectangleMachine } from "./machine.js";

type SelectionMessage =
  | ReturnType<typeof Message.PreparedSelection>
  | ReturnType<typeof Message.ModifiedEventSelection>
  | ReturnType<typeof Message.SelectedRectangle>
  | ReturnType<typeof Message.PreviewedSelectionRectangle>;

export const PrepareSelection = Mount.defineStream("PrepareSelection", {
  args: { hostKey: Schema.String, personId: Schema.String },
  execute: ({ element, hostKey, personId }) =>
    Stream.callback<SelectionMessage>((queue) =>
      Effect.gen(function* prepareSelection() {
        if (!(element instanceof HTMLElement)) {
          return;
        }

        const actor = yield* createEffectActor(rectangleMachine);
        yield* watchActor("calendar.selection.rectangle", actor);
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            element.dataset.selectionPhase = "idle";

            return actor.subscribe((snapshot) => {
              let phase: "idle" | "armed" | "dragging" = "idle";

              if (snapshot.matches("armed")) {
                phase = "armed";
              }

              if (snapshot.matches("dragging")) {
                phase = "dragging";
              }

              element.dataset.selectionPhase = phase;
            });
          }),
          (subscription) =>
            Effect.sync(() => {
              subscription.unsubscribe();
              Reflect.deleteProperty(element.dataset, "selectionPhase");
            })
        );
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            bindSelectionEvents({
              actor,
              preview: (box) => {
                Queue.offerUnsafe(
                  queue,
                  Message.PreviewedSelectionRectangle({
                    box,
                    hostKey,
                    personId,
                  })
                );
              },
              replace: (keys) => {
                Queue.offerUnsafe(
                  queue,
                  Message.SelectedRectangle({ hostKey, keys, personId })
                );
              },
              root: element,
              toggle: (key, mod, shift) => {
                Queue.offerUnsafe(
                  queue,
                  Message.ModifiedEventSelection({
                    hostKey,
                    key,
                    mod,
                    personId,
                    shift,
                  })
                );
              },
            })
          ),
          (release) => Effect.sync(release)
        );
        Queue.offerUnsafe(queue, Message.PreparedSelection());
      })
    ),
  messages: [
    Message.PreparedSelection,
    Message.ModifiedEventSelection,
    Message.SelectedRectangle,
    Message.PreviewedSelectionRectangle,
  ],
});
