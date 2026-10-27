import { CalendarEvent, RsvpInput } from "@calendar/calendar/contracts";
import {
  sameDesktopEventKey,
  TrayRsvpNote,
} from "@calendar/core/desktop-bridge";
import { createEffectLogic, setupEffect } from "@xstate/effect";
import { DateTime, Effect, Option, Schema } from "effect";
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

export const PreparedRsvpNote = Schema.Struct({
  id: Schema.Int,
  intent: TrayRsvpNote,
});

export const RsvpView = Schema.Struct({
  focused: Schema.Option(CalendarEvent),
  note: Schema.String,
  preparationError: Schema.optional(Schema.String),
  prepared: Schema.optional(PreparedRsvpNote),
  result: Schema.Option(RsvpResult),
  saving: Schema.Option(RsvpIntent),
});

interface Context {
  readonly focused: Option.Option<typeof CalendarEvent.Type>;
  readonly intent: typeof RsvpIntent.Type | undefined;
  readonly note: string;
  readonly preparationError: string | undefined;
  readonly preparationSequence: number;
  readonly prepared: typeof PreparedRsvpNote.Type | undefined;
  readonly result: typeof RsvpResult.Type | undefined;
  readonly sequence: number;
}

type ContextUpdate = { -readonly [Key in keyof Context]?: Context[Key] };

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

  const next: ContextUpdate = { intent, sequence: intent.id };

  if (notePolicy !== "omit" && context.prepared !== undefined) {
    next.prepared = undefined;
    next.preparationError = undefined;
  }

  return { context: next, target: "saving" };
};

const focus = (
  context: Context,
  event: Option.Option<typeof CalendarEvent.Type>
): Partial<Context> => {
  const same =
    Option.isSome(event) &&
    Option.isSome(context.focused) &&
    eventKey(event.value) === eventKey(context.focused.value);

  const next: ContextUpdate = {
    focused: event,
    note: same ? context.note : "",
  };

  if (!same && context.prepared !== undefined) {
    next.prepared = undefined;
    next.preparationError = undefined;
  }

  return next;
};

const prepareNote = (
  context: Context,
  event: typeof CalendarEvent.Type,
  intent: typeof TrayRsvpNote.Type
): Partial<Context> => {
  const instant =
    event.start !== undefined && "dateTime" in event.start
      ? Option.map(DateTime.make(event.start.dateTime), DateTime.toEpochMillis)
      : Option.none<number>();

  if (
    rsvpSelf(event) === undefined ||
    !sameDesktopEventKey(event, intent.key) ||
    Option.getOrUndefined(instant) !== intent.start
  ) {
    return {
      preparationError:
        "This meeting is no longer available for a response note.",
    };
  }

  if (
    context.note.length > 0 &&
    Option.isSome(context.focused) &&
    eventKey(context.focused.value) !== eventKey(event)
  ) {
    return {
      preparationError:
        "Finish or clear the current response note before opening another meeting.",
    };
  }

  const id = context.preparationSequence + 1;

  return {
    ...focus(context, Option.some(event)),
    preparationError: undefined,
    preparationSequence: id,
    prepared: { id, intent },
  };
};

export const rsvpMachine = setupEffect({
  actors: { respond },
  schemas: {
    context: types<Context>(),
    events: {
      CHOOSE: Schema.Struct({ response: Response }),
      CLEAR_NOTE: Schema.Struct({ prepared: PreparedRsvpNote }),
      FOCUS: Schema.Struct({ event: Schema.Option(CalendarEvent) }),
      NOTE: Schema.Struct({ note: Schema.String }),
      RESPOND: Schema.Struct({ event: CalendarEvent, response: Response }),
      STAGE_NOTE: Schema.Struct({ event: CalendarEvent, intent: TrayRsvpNote }),
    },
  },
}).createMachine({
  context: {
    focused: Option.none(),
    intent: undefined,
    note: "",
    preparationError: undefined,
    preparationSequence: 0,
    prepared: undefined,
    result: undefined,
    sequence: 0,
  },
  initial: "idle",
  on: {
    CLEAR_NOTE: ({ context, event }) =>
      context.prepared?.id === event.prepared.id &&
      context.prepared.intent.personId === event.prepared.intent.personId &&
      context.prepared.intent.lease === event.prepared.intent.lease
        ? { context: { preparationError: undefined, prepared: undefined } }
        : {},
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
        STAGE_NOTE: ({ context, event }) => ({
          context: prepareNote(context, event.event, event.intent),
        }),
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
      on: {
        STAGE_NOTE: () => ({
          context: {
            preparationError:
              "Wait for the current response to finish before opening a note.",
          },
        }),
      },
    },
  },
});

type MutableRsvpView = {
  -readonly [Key in keyof typeof RsvpView.Type]: (typeof RsvpView.Type)[Key];
};

export const projectRsvp = (
  snapshot: SnapshotFrom<typeof rsvpMachine>
): typeof RsvpView.Type => {
  const view: MutableRsvpView = {
    focused: snapshot.context.focused,
    note: snapshot.context.note,
    result: Option.fromUndefinedOr(snapshot.context.result),
    saving: snapshot.matches("saving")
      ? Option.fromUndefinedOr(snapshot.context.intent)
      : Option.none(),
  };

  if (snapshot.context.preparationError !== undefined) {
    view.preparationError = snapshot.context.preparationError;
  }

  if (snapshot.context.prepared !== undefined) {
    view.prepared = snapshot.context.prepared;
  }

  return view;
};
