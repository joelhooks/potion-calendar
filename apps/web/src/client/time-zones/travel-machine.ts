import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import { DisplayZone } from "../../layout/time-zones.js";

export const TravelEvent = Schema.TaggedUnion({
  Home: {},
  Travel: { zone: DisplayZone },
});

export const TravelState = Schema.Struct({
  temporary: Schema.Option(DisplayZone),
});

type TravelContext = typeof TravelState.Type;

export const travelMachine = setupEffect({
  schemas: {
    context: types<TravelContext>(),
    events: {
      Home: Schema.Struct({}),
      Travel: Schema.Struct({ zone: DisplayZone }),
    },
    input: TravelState,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  on: {
    Home: { context: { temporary: Option.none() }, target: ".home" },
    Travel: {
      context: ({ event }) => ({ temporary: Option.some(event.zone) }),
      target: ".travelling",
    },
  },
  states: {
    home: {},
    restore: {
      always: ({ context }) => ({
        target: Option.isSome(context.temporary) ? "travelling" : "home",
      }),
    },
    travelling: {},
  },
});

export const travelTransition = (
  state: TravelContext,
  event: typeof TravelEvent.Type
): TravelContext => {
  const [snapshot] = initialTransition(travelMachine, state);

  return TravelEvent.match(event, {
    Home: () =>
      transition(travelMachine, snapshot, { type: "Home" })[0].context,
    Travel: ({ zone }) =>
      transition(travelMachine, snapshot, { type: "Travel", zone })[0].context,
  });
};
