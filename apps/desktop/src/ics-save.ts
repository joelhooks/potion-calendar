// @effect-diagnostics-next-line nodeBuiltinImport:off -- The native save handler validates only the path returned by the user's OS dialog.
import nodePath from "node:path";

import { watchActor } from "@calendar/capability/actor-watch";
import {
  IcsSaveFailureReason,
  IcsSaveOutcome,
  desktopWire,
  icsSaveParseOptions,
} from "@calendar/core/desktop-bridge";
import type { IcsSaveRequest } from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";
import { types } from "xstate";

import type { IcsSaveError } from "./ics-save-error.js";

export { IcsSaveError } from "./ics-save-error.js";

export const IcsSaveChoice = Schema.TaggedUnion({
  Cancelled: {},
  Chosen: { path: Schema.String },
});

export interface IcsSavePort {
  readonly choose: (
    suggestedName: string
  ) => Effect.Effect<typeof IcsSaveChoice.Type, IcsSaveError>;
  readonly write: (
    path: string,
    bytes: Uint8Array
  ) => Effect.Effect<void, IcsSaveError>;
}

const IcsChosenPath = Schema.String.check(
  Schema.isPattern(/\.ics$/iu),
  Schema.makeFilter(
    (value) => nodePath.isAbsolute(value) && !value.includes("\u0000")
  )
);

export const IcsDialogOutcome = Schema.TaggedUnion({
  Cancelled: {},
  Chosen: {},
  Failed: { reason: IcsSaveFailureReason },
});

interface IcsSaveContext {
  readonly outcome: Option.Option<typeof IcsSaveOutcome.Type>;
}

type IcsWriteOutcome = Extract<
  typeof IcsSaveOutcome.Type,
  { readonly _tag: "Saved" | "Failed" }
>;

export interface IcsSaveWork {
  readonly choose: Effect.Effect<typeof IcsDialogOutcome.Type>;
  readonly write: Effect.Effect<IcsWriteOutcome>;
}

export const icsSaveMachine = (work: IcsSaveWork) => {
  const choose = createEffectLogic({ effect: work.choose });
  const write = createEffectLogic({ effect: work.write });

  return setupEffect({
    actors: { choose, write },
    schemas: { context: types<IcsSaveContext>() },
  }).createMachine({
    context: { outcome: Option.none() },
    initial: "idle",
    output: ({ context }) => context.outcome,
    states: {
      cancelled: { type: "final" },
      choosing: {
        invoke: {
          onDone: ({ context, event }) => {
            if (IcsDialogOutcome.guards.Chosen(event.output)) {
              return { target: "writing" };
            }

            return IcsDialogOutcome.guards.Cancelled(event.output)
              ? {
                  context: {
                    ...context,
                    outcome: Option.some(
                      IcsSaveOutcome.cases.Cancelled.make({})
                    ),
                  },
                  target: "cancelled",
                }
              : {
                  context: {
                    ...context,
                    outcome: Option.some(
                      IcsSaveOutcome.cases.Failed.make({
                        reason: event.output.reason,
                      })
                    ),
                  },
                  target: "failed",
                };
          },
          src: "choose",
        },
      },
      failed: { type: "final" },
      idle: { always: { target: "choosing" } },
      saved: { type: "final" },
      writing: {
        invoke: {
          onDone: ({ context, event }) => ({
            context: { ...context, outcome: Option.some(event.output) },
            target: IcsSaveOutcome.guards.Saved(event.output)
              ? "saved"
              : "failed",
          }),
          src: "write",
        },
      },
    },
  });
};

const runIcsSave = Effect.fn("Desktop.runIcsSave")(function* runIcsSave(
  request: typeof IcsSaveRequest.Type,
  port: IcsSavePort,
  trusted: Effect.Effect<boolean>
) {
  const bytes = new Uint8Array(request.bytes);
  const path = yield* Ref.make(Option.none<string>());

  const choose = Effect.gen(function* chooseIcsPath() {
    if (!(yield* trusted)) {
      return IcsDialogOutcome.cases.Failed.make({ reason: "untrusted" });
    }

    const choice = yield* port.choose(request.suggestedName);

    if (IcsSaveChoice.guards.Cancelled(choice)) {
      return IcsDialogOutcome.cases.Cancelled.make({});
    }

    if (!(yield* trusted)) {
      return IcsDialogOutcome.cases.Failed.make({ reason: "untrusted" });
    }

    const selected = yield* Schema.decodeEffect(IcsChosenPath)(
      choice.path
    ).pipe(Effect.option);

    if (Option.isNone(selected)) {
      return IcsDialogOutcome.cases.Failed.make({ reason: "invalid" });
    }

    yield* Ref.set(path, selected);

    return IcsDialogOutcome.cases.Chosen.make({});
  }).pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This recovers a typed Effect failure, not a native Promise callback.
    Effect.orElseSucceed((error) =>
      IcsDialogOutcome.cases.Failed.make({ reason: error.reason })
    )
  );

  const write: Effect.Effect<IcsWriteOutcome> = Effect.gen(
    function* writeChosenIcs() {
      if (!(yield* trusted)) {
        return IcsSaveOutcome.cases.Failed.make({ reason: "untrusted" });
      }

      const selected = yield* Ref.get(path);

      if (Option.isNone(selected)) {
        return yield* Effect.die(new Error("ICS save has no chosen path"));
      }

      yield* port.write(selected.value, bytes);

      return IcsSaveOutcome.cases.Saved.make({});
    }
  ).pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This recovers a typed Effect failure, not a native Promise callback.
    Effect.orElseSucceed((error) =>
      IcsSaveOutcome.cases.Failed.make({ reason: error.reason })
    )
  );

  const actor = yield* createEffectActor(icsSaveMachine({ choose, write }));
  yield* watchActor("desktopIcsSave", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine-level join failures become defects; typed dialog and write failures remain explicit outcomes.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  return Option.getOrThrow(outcome);
}, Effect.scoped);

const makeIcsSaveHandler = Effect.fn("Desktop.makeIcsSaveHandler")(
  function* makeIcsSaveHandler(port: IcsSavePort) {
    const admission = yield* Semaphore.make(1);

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native IPC payloads are untrusted until decoded by the bounded shared wire schema.
    return (payload: unknown, trusted: Effect.Effect<boolean>) =>
      Effect.gen(function* handleIcsSave() {
        const outcome = yield* Effect.gen(function* acceptIcsSave() {
          if (!(yield* trusted)) {
            return IcsSaveOutcome.cases.Failed.make({ reason: "untrusted" });
          }

          const request = yield* Schema.decodeUnknownEffect(
            desktopWire.saveIcs,
            icsSaveParseOptions
          )(payload).pipe(Effect.option);

          if (Option.isNone(request)) {
            return IcsSaveOutcome.cases.Failed.make({ reason: "invalid" });
          }

          const accepted = yield* runIcsSave(request.value, port, trusted).pipe(
            admission.withPermitsIfAvailable(1)
          );

          return Option.getOrElse(accepted, () =>
            IcsSaveOutcome.cases.Failed.make({ reason: "busy" })
          );
        });

        return yield* Schema.encodeEffect(desktopWire.saveIcsReply)(outcome);
      });
  }
);

export class IcsFileSaver extends Context.Service<
  IcsFileSaver,
  { readonly handle: Effect.Success<ReturnType<typeof makeIcsSaveHandler>> }
>()("@calendar/desktop/IcsFileSaver") {
  static readonly layer = (port: IcsSavePort) =>
    Layer.effect(
      IcsFileSaver,
      makeIcsSaveHandler(port).pipe(
        Effect.map((handle) => IcsFileSaver.of({ handle }))
      )
    );
}
