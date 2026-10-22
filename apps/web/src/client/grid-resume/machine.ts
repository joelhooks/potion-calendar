import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";

export const longBackgroundMillis = 30 * 60_000;

export const visibilityResumeMachine = setupEffect({
  schemas: {
    context: Schema.Struct({
      hiddenSince: Schema.Option(Schema.Finite),
      resumeAt: Schema.Option(Schema.Finite),
    }),
    events: {
      HIDDEN: Schema.Struct({ now: Schema.Finite }),
      VISIBLE: Schema.Struct({ now: Schema.Finite }),
    },
  },
}).createMachine({
  context: { hiddenSince: Option.none(), resumeAt: Option.none() },
  initial: "visible",
  states: {
    hidden: {
      on: {
        VISIBLE: {
          context: ({ context, event }) => ({
            hiddenSince: Option.none(),
            resumeAt:
              Option.isSome(context.hiddenSince) &&
              event.now - context.hiddenSince.value >= longBackgroundMillis
                ? Option.some(event.now)
                : Option.none(),
          }),
          target: "visible",
        },
      },
    },
    visible: {
      on: {
        HIDDEN: {
          context: ({ event }) => ({
            hiddenSince: Option.some(event.now),
            resumeAt: Option.none(),
          }),
          target: "hidden",
        },
        VISIBLE: { context: { resumeAt: Option.none() } },
      },
    },
  },
});
