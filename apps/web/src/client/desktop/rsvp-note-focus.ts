import { trayRsvpNoteToken } from "@calendar/core/desktop-bridge";
import { setupEffect } from "@xstate/effect";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Command, Render } from "foldkit";
import type { Update } from "foldkit";
import { initialTransition, transition, types } from "xstate";
import type { EventFromLogic, SnapshotFrom } from "xstate";

import type { AppMessage, AppModel, update } from "../app.js";
import { responseIsBusy } from "../editing/response-availability.js";
import { Message } from "../message.js";
import { readyRsvpNote, rsvpNoteField } from "./rsvp-note.js";

export const trayRsvpNoteBusyFocusPolicy =
  "restore-only-owned-current-preparation";

export const trayRsvpNoteBusyFocusCancellation =
  "discard-on-user-intent-or-window-blur";

export const NoteFocusTarget = Schema.Struct({
  pane: Schema.Literals(["phone", "desktop"]),
  token: Schema.String,
});

export const NoteFocusObservation = Schema.Struct({
  busy: Schema.Boolean,
  target: Schema.Option(NoteFocusTarget),
});

const FocusContext = Schema.Struct({
  ...NoteFocusObservation.fields,
  epoch: Schema.Int,
});

export const NoteFocusTicket = Schema.Struct({
  epoch: Schema.Int,
  target: NoteFocusTarget,
});

const sameTarget = (
  left: Option.Option<typeof NoteFocusTarget.Type>,
  right: Option.Option<typeof NoteFocusTarget.Type>
) =>
  Option.getOrUndefined(left)?.token === Option.getOrUndefined(right)?.token &&
  Option.getOrUndefined(left)?.pane === Option.getOrUndefined(right)?.pane;

const observedContext = (
  context: typeof FocusContext.Type,
  event: typeof NoteFocusObservation.Type
) => ({
  busy: event.busy,
  epoch:
    sameTarget(context.target, event.target) && context.busy === event.busy
      ? context.epoch
      : context.epoch + 1,
  target: event.target,
});

interface OwnedFocusTransition {
  context: typeof FocusContext.Type;
  target?: "unowned" | "suspended";
}

const observeOwned = (
  context: typeof FocusContext.Type,
  event: typeof NoteFocusObservation.Type
): OwnedFocusTransition => {
  const next = observedContext(context, event);

  if (!sameTarget(context.target, event.target)) {
    return { context: next, target: "unowned" };
  }

  if (event.busy) {
    return { context: next, target: "suspended" };
  }

  return { context: next };
};

export const noteFocusMachine = setupEffect({
  schemas: {
    context: types<typeof FocusContext.Type>(),
    events: {
      Cancel: Schema.Struct({}),
      Commit: NoteFocusTicket,
      Dispose: Schema.Struct({}),
      Observe: NoteFocusObservation,
      Own: Schema.Struct({ token: Schema.String }),
    },
    input: Schema.Struct({}),
  },
}).createMachine({
  context: { busy: false, epoch: 0, target: Option.none() },
  initial: "unowned",
  on: {
    Cancel: {
      context: ({ context }) => ({ ...context, epoch: context.epoch + 1 }),
      target: ".unowned",
    },
    Dispose: {
      context: ({ context }) => ({ ...context, epoch: context.epoch + 1 }),
      target: ".closed",
    },
  },
  states: {
    closed: { type: "final" },
    owned: {
      on: {
        Observe: ({ context, event }) => observeOwned(context, event),
      },
    },
    pending: {
      on: {
        Commit: ({ context, event }) => {
          if (
            context.epoch !== event.epoch ||
            !sameTarget(context.target, Option.some(event.target))
          ) {
            return {};
          }

          return {
            context: { ...context, epoch: context.epoch + 1 },
            target: "owned",
          };
        },
        Observe: ({ context, event }) => observeOwned(context, event),
        Own: {
          context: ({ context }) => ({ ...context, epoch: context.epoch + 1 }),
          target: "owned",
        },
      },
    },
    suspended: {
      on: {
        Observe: ({ context, event }) => {
          const next = observedContext(context, event);

          if (!sameTarget(context.target, event.target)) {
            return { context: next, target: "unowned" };
          }

          if (event.busy) {
            return { context: next };
          }

          return { context: next, target: "pending" };
        },
      },
    },
    unowned: {
      on: {
        Observe: {
          context: ({ context, event }) => observedContext(context, event),
        },
        Own: ({ context, event }) => {
          if (
            context.busy ||
            Option.getOrUndefined(context.target)?.token !== event.token
          ) {
            return {};
          }

          return { target: "owned" };
        },
      },
    },
  },
});

export const initialNoteFocus = () =>
  initialTransition(noteFocusMachine, {})[0];

export const transitionNoteFocus = (
  state: SnapshotFrom<typeof noteFocusMachine>,
  event: EventFromLogic<typeof noteFocusMachine>
) => transition(noteFocusMachine, state, event)[0];

export class RsvpNoteFocus extends Context.Service<
  RsvpNoteFocus,
  {
    observe: (
      observation: typeof NoteFocusObservation.Type
    ) => Effect.Effect<Option.Option<typeof NoteFocusTicket.Type>>;
    resume: (ticket: typeof NoteFocusTicket.Type) => Effect.Effect<boolean>;
    snapshot: Effect.Effect<SnapshotFrom<typeof noteFocusMachine>>;
  }
>()("@calendar/web/desktop/RsvpNoteFocus") {
  static readonly layer = Layer.effect(
    RsvpNoteFocus,
    Effect.gen(function* focusLayer() {
      let state = initialNoteFocus();

      const send = (event: EventFromLogic<typeof noteFocusMachine>) => {
        state = transitionNoteFocus(state, event);
      };

      const field = () =>
        state.context.target.pipe(
          Option.map((target) => rsvpNoteField(target.pane, target.token)),
          Option.getOrUndefined
        );

      const cancel = () => {
        send({ type: "Cancel" });
      };

      const focusin = (event: FocusEvent) => {
        const target = field();

        if (target !== undefined && event.target === target) {
          send({ token: target.dataset.trayRsvpNote ?? "", type: "Own" });
        } else if (
          event.target !== document.body &&
          event.target !== document.documentElement
        ) {
          cancel();
        }
      };

      const pointerdown = (event: PointerEvent) => {
        if (event.target !== field()) {
          cancel();
        }
      };

      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Tab") {
          cancel();
        }
      };

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          document.addEventListener("focusin", focusin, true);
          document.addEventListener("pointerdown", pointerdown, true);
          document.addEventListener("keydown", keydown, true);
          window.addEventListener("blur", cancel);
        }),
        () =>
          Effect.sync(() => {
            send({ type: "Dispose" });
            document.removeEventListener("focusin", focusin, true);
            document.removeEventListener("pointerdown", pointerdown, true);
            document.removeEventListener("keydown", keydown, true);
            window.removeEventListener("blur", cancel);
          })
      );

      const observe = Effect.fn("RsvpNoteFocus.observe")(
        (observation: typeof NoteFocusObservation.Type) =>
          Effect.sync(() => {
            const previous = state;
            send({ type: "Observe", ...observation });

            return state.matches("pending") && !previous.matches("pending")
              ? state.context.target.pipe(
                  Option.map((target) =>
                    NoteFocusTicket.make({ epoch: state.context.epoch, target })
                  )
                )
              : Option.none();
          })
      );

      const resume = Effect.fn("RsvpNoteFocus.resume")(
        (ticket: typeof NoteFocusTicket.Type) =>
          Effect.sync(() => {
            if (
              !state.matches("pending") ||
              state.context.epoch !== ticket.epoch ||
              !sameTarget(state.context.target, Option.some(ticket.target))
            ) {
              return false;
            }

            const target = field();

            if (
              !document.hasFocus() ||
              target === undefined ||
              target.id !== "rsvp-note" ||
              target.disabled ||
              (document.activeElement !== document.body &&
                document.activeElement !== document.documentElement &&
                document.activeElement !== target)
            ) {
              cancel();

              return false;
            }

            send({ type: "Commit", ...ticket });
            target.focus();
            target.setSelectionRange(target.value.length, target.value.length);

            return true;
          })
      );

      return RsvpNoteFocus.of({
        observe,
        resume,
        snapshot: Effect.sync(() => state),
      });
    })
  );
}

export const ObserveRsvpNoteFocus = Command.define("ObserveRsvpNoteFocus", {
  args: NoteFocusObservation.fields,
  execute: (observation) =>
    RsvpNoteFocus.use((focus) =>
      focus.observe(observation).pipe(
        Effect.flatMap((ticket) =>
          Option.match(ticket, {
            onNone: () => Effect.void,
            onSome: (current) =>
              Render.afterCommit.pipe(
                Effect.andThen(focus.resume(current)),
                Effect.asVoid
              ),
          })
        ),
        Effect.as(Message.CompletedRsvpNoteFocus())
      )
    ),
  messages: [Message.CompletedRsvpNoteFocus],
});

export const noteFocusObservation = (model: AppModel) =>
  NoteFocusObservation.make({
    busy: responseIsBusy(model),
    target: Option.map(readyRsvpNote(model), ({ pane, prepared }) =>
      NoteFocusTarget.make({
        pane,
        token: trayRsvpNoteToken(prepared.intent, prepared.id),
      })
    ),
  });

type RootServices = Effect.Services<
  NonNullable<ReturnType<typeof update>["commands"]>[number]["effect"]
>;

export const withRsvpNoteFocusOwnership =
  (rootUpdate: typeof update) =>
  (
    model: AppModel,
    message: AppMessage
  ): Update.Return<AppModel, AppMessage, RootServices | RsvpNoteFocus> => {
    const result = rootUpdate(model, message);
    const before = noteFocusObservation(model);
    const after = noteFocusObservation(result.model);

    return before.busy === after.busy && sameTarget(before.target, after.target)
      ? result
      : {
          ...result,
          commands: [...(result.commands ?? []), ObserveRsvpNoteFocus(after)],
        };
  };
