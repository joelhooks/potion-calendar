import { CalendarEvent, RsvpInput } from "@calendar/calendar/contracts";
import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Option, Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import { rsvpSelf } from "../../layout/rsvp-eligibility.js";
import { eventKey } from "../calendar-state.js";
import { CalendarEditingClient } from "./calendar-client.js";
import { MutationFailure } from "./failure.js";

const Response = Schema.Literals(["accepted", "declined", "tentative"]);

export const RsvpIntent = Schema.Struct({
  event: CalendarEvent,
  id: Schema.Int,
  request: RsvpInput,
});

export const RsvpResult = Schema.TaggedUnion({
  Failed: { failure: MutationFailure, intent: RsvpIntent },
  Saved: { event: CalendarEvent, intent: RsvpIntent },
});

export const RsvpView = Schema.Struct({
  focused: Schema.Option(CalendarEvent),
  note: Schema.String,
  result: Schema.Option(RsvpResult),
  saving: Schema.Option(RsvpIntent),
});

interface Context {
  readonly focused: Option.Option<typeof CalendarEvent.Type>;
  readonly intent: typeof RsvpIntent.Type | undefined;
  readonly note: string;
  readonly result: typeof RsvpResult.Type | undefined;
  readonly sequence: number;
}

const respond = createEffectLogic({
  effect: ({ input }) =>
    CalendarEditingClient.use((client) => client.rsvp(input.request)).pipe(
      Effect.match({
        onFailure: (failure) =>
          RsvpResult.cases.Failed.make({ failure, intent: input }),
        onSuccess: (event) =>
          RsvpResult.cases.Saved.make({ event, intent: input }),
      })
    ),
  schemas: { input: RsvpIntent },
});

const canRespond = (context: Context): boolean =>
  Option.isSome(context.focused) &&
  rsvpSelf(context.focused.value) !== undefined;

interface RequestTransition {
  readonly context: Partial<Context>;
  readonly target: "saving";
}

const request = (
  context: Context,
  response: typeof Response.Type,
  notePolicy?: "omit"
): RequestTransition => {
  const event = Schema.decodeUnknownSync(CalendarEvent)(
    Option.getOrUndefined(context.focused)
  );

  const input: typeof RsvpInput.Type = {
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.eventId,
    response,
    sendUpdates: "none",
  };

  const intent = RsvpIntent.make({
    event,
    id: context.sequence + 1,
    request: notePolicy === "omit" ? input : { ...input, note: context.note },
  });

  return { context: { intent, sequence: intent.id }, target: "saving" };
};

const focus = (
  context: Context,
  event: Option.Option<typeof CalendarEvent.Type>
): Partial<Context> => {
  const same =
    Option.isSome(event) &&
    Option.isSome(context.focused) &&
    eventKey(event.value) === eventKey(context.focused.value);

  return { focused: event, note: same ? context.note : "" };
};

export const rsvpMachine = setupEffect({
  actors: { respond },
  schemas: {
    context: types<Context>(),
    events: {
      CHOOSE: Schema.Struct({ response: Response }),
      FOCUS: Schema.Struct({ event: Schema.Option(CalendarEvent) }),
      NOTE: Schema.Struct({ note: Schema.String }),
      RESPOND: Schema.Struct({ event: CalendarEvent, response: Response }),
    },
  },
}).createMachine({
  context: {
    focused: Option.none(),
    intent: undefined,
    note: "",
    result: undefined,
    sequence: 0,
  },
  initial: "idle",
  on: {
    FOCUS: ({ context, event }) => ({ context: focus(context, event.event) }),
    NOTE: ({ event }) => ({ context: { note: event.note } }),
  },
  states: {
    idle: {
      on: {
        CHOOSE: ({ context, event }) =>
          canRespond(context) ? request(context, event.response) : {},
        RESPOND: ({ context, event }) =>
          rsvpSelf(event.event) === undefined
            ? {}
            : request(
                { ...context, focused: Option.some(event.event) },
                event.response,
                "omit"
              ),
      },
    },
    saving: {
      invoke: {
        input: ({ context }) =>
          Schema.decodeUnknownSync(RsvpIntent)(context.intent),
        onDone: ({ event }) => ({
          context: { result: event.output },
          target: "idle",
        }),
        src: "respond",
      },
    },
  },
});

export const projectRsvp = (
  snapshot: SnapshotFrom<typeof rsvpMachine>
): typeof RsvpView.Type => ({
  focused: snapshot.context.focused,
  note: snapshot.context.note,
  result: Option.fromUndefinedOr(snapshot.context.result),
  saving: snapshot.matches("saving")
    ? Option.fromUndefinedOr(snapshot.context.intent)
    : Option.none(),
});
