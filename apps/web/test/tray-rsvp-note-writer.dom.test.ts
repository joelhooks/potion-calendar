import type {
  Provider,
  CalendarEventValue,
  RsvpInput,
} from "@calendar/calendar/contracts";
import { TrayRsvpNote } from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  DateTime,
  Deferred,
  Effect,
  Layer,
  Option,
  Queue,
  Result,
  Stream,
} from "effect";

import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import type { RsvpView } from "../src/client/editing/rsvp-machine.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { savedUpcomingEvent, upcomingPerson } from "./upcoming-fixture.js";

const event: CalendarEventValue = {
  ...savedUpcomingEvent,
  attendees: [
    { email: "self@example.test", responseStatus: "needsAction", self: true },
  ],
  eventId: "series_20261021T090000Z",
  recurringEventId: "series",
};

const responses: readonly (typeof TrayRsvpNote.Type)["response"][] = [
  "accepted",
  "declined",
  "tentative",
];

const intent = TrayRsvpNote.make({
  key: {
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.eventId,
  },
  lease: "lease",
  personId: upcomingPerson,
  response: "accepted",
  start: DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T09:00:00Z")),
});

const hosted = Effect.fn("RsvpNoteTest.hosted")(function* hosted() {
  const calls = yield* Queue.unbounded<typeof RsvpInput.Type>();
  const notices = yield* Queue.unbounded<typeof EditingNotice.Type>();
  const reply = yield* Deferred.make<CalendarEventValue, Provider>();
  const unexpected = Effect.die("Response note reached another writer");

  const client = CalendarEditingClient.of({
    createEvent: () => unexpected,
    deleteEvent: () => unexpected,
    getEvent: () => unexpected,
    moveAndRetimeSeries: () => unexpected,
    moveEvent: () => unexpected,
    moveSupport: "notAvailable",
    rsvp: (input) =>
      Queue.offer(calls, input).pipe(Effect.andThen(Deferred.await(reply))),
    updateEvent: () => unexpected,
  });

  const services = Layer.merge(
    Layer.succeed(CalendarEditingClient, client),
    Layer.succeed(
      DeletionWriter,
      DeletionWriter.of({ commit: () => unexpected })
    )
  );

  const context = yield* Layer.build(
    EditingRuntime.layer.pipe(Layer.provide(services))
  );

  const runtime = yield* Effect.service(EditingRuntime).pipe(
    Effect.provide(context)
  );

  const stream = yield* runtime.connect(upcomingPerson);
  yield* stream.pipe(
    Stream.runForEach((notice) => Queue.offer(notices, notice)),
    Effect.forkScoped
  );

  return { calls, notices, reply, runtime };
});

const nextResponse = (
  notices: Queue.Queue<typeof EditingNotice.Type>,
  accept: (view: typeof RsvpView.Type) => boolean
) =>
  Stream.fromQueue(notices).pipe(
    Stream.filter(
      (notice) => EditingNotice.guards.Rsvp(notice) && accept(notice.view)
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.map((notice) =>
      EditingNotice.guards.Rsvp(notice) ? notice.view : undefined
    )
  );

it.effect.each(responses)(
  "staging and typing %s never sends an RSVP; one explicit details action sends the note for the occurrence",
  (response) =>
    Effect.gen(function* explicitNoteHistory() {
      const h = yield* hosted();
      const preparedIntent = { ...intent, response };
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({ event, intent: preparedIntent })
      );
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpNote.make({
          event,
          note: "P57 typed note barrier",
        })
      );

      const staged = yield* nextResponse(
        h.notices,
        (value) => value.note === "P57 typed note barrier"
      );

      expect(staged?.prepared?.intent).toEqual(preparedIntent);
      expect(staged?.saving).toEqual(Option.none());
      expect(staged?.result).toEqual(Option.none());
      expect(yield* Queue.size(h.calls)).toBe(0);
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.Rsvp.make({ event, response })
      );
      const request = yield* Queue.take(h.calls);
      expect(request).toEqual({
        accountId: event.accountId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        note: "P57 typed note barrier",
        response,
        sendUpdates: "none",
      });
      expect(request).not.toHaveProperty("scope");
      yield* Deferred.succeed(h.reply, event);

      const saved = yield* nextResponse(h.notices, (value) =>
        Option.isSome(value.result)
      );

      expect(saved?.prepared).toBeUndefined();
      expect(yield* Queue.size(h.calls)).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "same-target drafts survive preparation and another target cannot overwrite them",
  () =>
    Effect.gen(function* draftOwnership() {
      const h = yield* hosted();
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpNote.make({ event, note: "Keep this draft" })
      );
      yield* nextResponse(
        h.notices,
        (value) => value.note === "Keep this draft"
      );
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({ event, intent })
      );

      const ready = yield* nextResponse(
        h.notices,
        (value) => value.prepared !== undefined
      );

      expect(ready?.note).toBe("Keep this draft");
      const other = { ...event, eventId: "other-occurrence" };
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({
          event: other,
          intent: { ...intent, key: { ...intent.key, eventId: other.eventId } },
        })
      );

      const refused = yield* nextResponse(
        h.notices,
        (value) =>
          value.preparationError !== undefined ||
          value.prepared?.intent.key.eventId === other.eventId
      );

      expect(refused?.preparationError).toBeDefined();
      expect(refused?.note).toBe("Keep this draft");
      expect(
        Option.getOrUndefined(refused?.focused ?? Option.none())?.eventId
      ).toBe(event.eventId);
      expect(refused?.prepared).toEqual(ready?.prepared);
      expect(yield* Queue.size(h.calls)).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "clearing preparation preserves the draft and a late clear cannot erase its replacement",
  () =>
    Effect.gen(function* clearHistory() {
      const h = yield* hosted();
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({ event, intent })
      );
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpNote.make({ event, note: "Retain on close" })
      );

      const first = yield* nextResponse(
        h.notices,
        (value) => value.note === "Retain on close"
      );

      const old = first?.prepared;
      expect(old).toBeDefined();

      if (old === undefined) {
        return yield* Effect.die("Preparation missing");
      }

      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({
          event,
          intent: { ...intent, response: "tentative" },
        })
      );

      const second = yield* nextResponse(
        h.notices,
        (value) => value.prepared?.intent.response === "tentative"
      );

      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpClearPreparation.make({ prepared: old })
      );
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpNote.make({
          event,
          note: "Late-clear barrier",
        })
      );

      const survived = yield* nextResponse(
        h.notices,
        (value) => value.note === "Late-clear barrier"
      );

      expect(survived?.prepared).toEqual(second?.prepared);
      const current = survived?.prepared;

      if (current === undefined) {
        return yield* Effect.die("Replacement missing");
      }

      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpClearPreparation.make({ prepared: current })
      );

      const cleared = yield* nextResponse(
        h.notices,
        (value) =>
          value.prepared === undefined && value.note === "Late-clear barrier"
      );

      expect(cleared?.note).toBe("Late-clear barrier");
      expect(yield* Queue.size(h.calls)).toBe(0);

      return yield* Effect.void;
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "an active write refuses preparation without starting a second request",
  () =>
    Effect.gen(function* busyHistory() {
      const h = yield* hosted();
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.Rsvp.make({ event, response: "accepted" })
      );
      yield* Queue.take(h.calls);
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({ event, intent })
      );

      const refused = yield* nextResponse(
        h.notices,
        (value) =>
          value.preparationError !== undefined || value.prepared !== undefined
      );

      expect(refused?.preparationError).toBeDefined();
      expect(refused?.prepared).toBeUndefined();
      expect(yield* Queue.size(h.calls)).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect("the person-scoped runtime refuses a foreign preparation owner", () =>
  Effect.gen(function* foreignOwner() {
    const h = yield* hosted();

    const failure = yield* h.runtime
      .dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpPrepare.make({
          event,
          intent: { ...intent, personId: "other" },
        })
      )
      .pipe(Effect.result);

    expect(Result.isFailure(failure)).toBe(true);

    if (Result.isFailure(failure)) {
      expect(failure.failure.message).toContain("another signed-in person");
    }

    expect(yield* Queue.size(h.calls)).toBe(0);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);
