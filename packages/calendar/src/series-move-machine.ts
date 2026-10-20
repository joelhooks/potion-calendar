import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Result, Schema } from "effect";
import { types } from "xstate";

import type { CalendarFailureValue } from "./errors.js";
import { CalendarEvent, CalendarRef, EventTime, SendUpdates } from "./model.js";
import type { CalendarEventValue } from "./model.js";
import {
  SeriesMoveRetimePartial,
  SeriesMoveRetimeUncertain,
  uncertainCalendarWrite,
} from "./series-move-result.js";
import type { SeriesMoveRetimeFailureValue } from "./series-move-result.js";

export const SeriesMovePlan = Schema.Struct({
  changes: Schema.Struct({ end: EventTime, start: EventTime }),
  destination: CalendarRef,
  master: CalendarEvent,
  sendUpdates: Schema.optional(SendUpdates),
});

export type SeriesMovePlanValue = typeof SeriesMovePlan.Type;

export class SeriesMoveSteps extends Context.Service<
  SeriesMoveSteps,
  {
    readonly move: (
      plan: SeriesMovePlanValue
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly retime: (
      plan: SeriesMovePlanValue,
      moved: CalendarEventValue
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
  }
>()("@calendar/calendar/SeriesMoveSteps") {}

const move = createEffectLogic({
  effect: ({ input }) =>
    SeriesMoveSteps.use((steps) => steps.move(input)).pipe(Effect.result),
  schemas: { input: SeriesMovePlan },
});

const retime = createEffectLogic({
  effect: ({ input }) =>
    SeriesMoveSteps.use((steps) => steps.retime(input.plan, input.moved)).pipe(
      Effect.result
    ),
  schemas: {
    input: Schema.Struct({ moved: CalendarEvent, plan: SeriesMovePlan }),
  },
});

type Outcome = Result.Result<CalendarEventValue, SeriesMoveRetimeFailureValue>;

interface SeriesMoveContext {
  readonly plan: SeriesMovePlanValue;
  readonly moved: CalendarEventValue;
  readonly outcome: Outcome | undefined;
}

export const seriesMoveMachine = setupEffect({
  actors: { move, retime },
  schemas: { context: types<SeriesMoveContext>(), input: SeriesMovePlan },
}).createMachine({
  context: ({ input }) => ({
    moved: input.master,
    outcome: undefined,
    plan: input,
  }),
  initial: "moving",
  output: ({ context }) => context.outcome,
  states: {
    completed: { type: "final" },
    failed: { type: "final" },
    moving: {
      invoke: {
        input: ({ context }) => context.plan,
        onDone: ({ context, event }) => {
          if (Result.isFailure(event.output)) {
            const cause = event.output.failure;

            const failure = uncertainCalendarWrite(cause)
              ? new SeriesMoveRetimeUncertain({
                  cause,
                  destination: context.plan.destination,
                  iCalUID: context.plan.master.iCalUID,
                  source: {
                    accountId: context.plan.master.accountId,
                    calendarId: context.plan.master.calendarId,
                    eventId: context.plan.master.eventId,
                  },
                })
              : cause;

            return {
              context: { outcome: Result.fail(failure) },
              target: "failed",
            };
          }

          return {
            context: { moved: event.output.success },
            target: "retiming",
          };
        },
        src: "move",
      },
    },
    retiming: {
      invoke: {
        input: ({ context }) => ({ moved: context.moved, plan: context.plan }),
        onDone: ({ context, event }) => {
          if (Result.isFailure(event.output)) {
            const cause = event.output.failure;

            return {
              context: {
                outcome: Result.fail(
                  new SeriesMoveRetimePartial({
                    cause,
                    changes: context.plan.changes,
                    completedStep: "move",
                    movedEvent: context.moved,
                    retimeOutcome: uncertainCalendarWrite(cause)
                      ? "unknown"
                      : "rejected",
                  })
                ),
              },
              target: "failed",
            };
          }

          return {
            context: { outcome: Result.succeed(event.output.success) },
            target: "completed",
          };
        },
        src: "retime",
      },
    },
  },
});

export const runSeriesMove = Effect.fn("runSeriesMove")(function* runSeriesMove(
  plan: SeriesMovePlanValue
) {
  const actor = yield* createEffectActor(seriesMoveMachine, { input: plan });
  yield* watchActor("seriesMoveMachine", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected actor failures remain defects; declared provider failures are explicit outcomes.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  if (outcome === undefined) {
    return yield* Effect.die(
      new Error("Series move finished without an outcome")
    );
  }

  return yield* Result.match(outcome, {
    onFailure: Effect.fail,
    onSuccess: Effect.succeed,
  });
}, Effect.scoped);
