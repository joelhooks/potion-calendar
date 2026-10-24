import { Provider } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  RsvpInput,
} from "@calendar/calendar/contracts";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Option, Queue, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { RsvpIntent, RsvpResult } from "../src/client/editing/rsvp-machine.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const event: CalendarEventValue = {
  ...savedUpcomingEvent,
  attendees: [
    { email: "self@example.test", responseStatus: "needsAction", self: true },
  ],
  eventId: "series_20261021T090000Z",
  recurringEventId: "series",
};

const hosted = Effect.fn("trayResponseHosted")(function* hosted() {
  const calls = yield* Queue.unbounded<typeof RsvpInput.Type>();
  const notices = yield* Queue.unbounded<typeof EditingNotice.Type>();
  const reply = yield* Deferred.make<CalendarEventValue, Provider>();
  const unexpected = Effect.die("Tray RSVP reached another writer");

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

const responseNotice = (
  notices: Queue.Queue<typeof EditingNotice.Type>,
  settled: boolean
) =>
  Stream.fromQueue(notices).pipe(
    Stream.filter(
      (notice) =>
        EditingNotice.guards.Rsvp(notice) &&
        (settled
          ? Option.isSome(notice.view.result)
          : notice.view.note === "Unsent details note")
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  );

it.effect.each(["accepted", "declined", "tentative"] as const)(
  "tray %s uses one existing writer for the occurrence without inheriting or erasing the details note",
  (response) =>
    Effect.gen(function* noteFreeResponse() {
      const h = yield* hosted();
      const details = { ...event, eventId: "another-details-event" };
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.RsvpNote.make({
          event: details,
          note: "Unsent details note",
        })
      );
      yield* responseNotice(h.notices, false);
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.Rsvp.make({ event, notePolicy: "omit", response })
      );
      const request = yield* Queue.take(h.calls);
      expect(request).toEqual({
        accountId: event.accountId,
        calendarId: event.calendarId,
        eventId: event.eventId,
        response,
        sendUpdates: "none",
      });
      expect(request).not.toHaveProperty("note");
      expect(request).not.toHaveProperty("scope");
      yield* Deferred.succeed(h.reply, {
        ...event,
        attendees: [
          { email: "self@example.test", responseStatus: response, self: true },
        ],
      });
      const notice = yield* responseNotice(h.notices, true);
      expect(EditingNotice.guards.Rsvp(notice)).toBe(true);

      if (EditingNotice.guards.Rsvp(notice)) {
        expect(notice.view.note).toBe("Unsent details note");
        expect(Option.getOrUndefined(notice.view.focused)?.eventId).toBe(
          details.eventId
        );
        expect(
          Option.isSome(notice.view.result) &&
            RsvpResult.guards.Saved(notice.view.result.value)
        ).toBe(true);
      }

      expect(yield* Queue.size(h.calls)).toBe(0);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "writer failure reaches the existing error surface without requesting an accepted-data refresh",
  () =>
    Effect.gen(function* visibleFailure() {
      const h = yield* hosted();
      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.Rsvp.make({
          event,
          notePolicy: "omit",
          response: "accepted",
        })
      );
      yield* Queue.take(h.calls);
      yield* Deferred.fail(
        h.reply,
        new Provider({
          message: "Fixture RSVP refused",
          operation: "rsvp",
          status: 403,
        })
      );
      const notice = yield* responseNotice(h.notices, true);
      const base = upcomingFixture();

      const result = update(
        base,
        Message.ReceivedEditing({ notice, personId: upcomingPerson })
      );

      expect(Option.getOrUndefined(result.model.error)).toBe(
        "Google could not complete the change. Review the current event before retrying."
      );
      expect(result.model.upcoming.request).toBe(base.upcoming.request);
      expect(result.commands ?? []).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "successful RSVP refreshes the accepted upcoming payload before changing the tray mark",
  () =>
    Effect.gen(function* acceptedRefresh() {
      const h = yield* hosted();
      const base = upcomingFixture();

      const loaded = update(
        base,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: base.upcoming.request,
          result: { events: [event], versions: [] },
        })
      ).model;

      yield* h.runtime.dispatch(
        upcomingPerson,
        EditingCommand.cases.Rsvp.make({
          event,
          notePolicy: "omit",
          response: "accepted",
        })
      );
      yield* Queue.take(h.calls);

      const saved = {
        ...event,
        attendees: [
          {
            email: "self@example.test",
            responseStatus: "accepted" as const,
            self: true,
          },
        ],
      };

      yield* Deferred.succeed(h.reply, saved);
      const notice = yield* responseNotice(h.notices, true);

      const pending = update(
        loaded,
        Message.ReceivedEditing({ notice, personId: upcomingPerson })
      ).model;

      expect(pending.upcoming.request).toBeGreaterThan(loaded.upcoming.request);
      expect(
        agendaSnapshot(pending, defaultDesktopPreferences()).events[0]?.rsvp
          ?.response
      ).toBe("needsAction");

      const accepted = update(
        pending,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: pending.upcoming.request,
          result: { events: [saved], versions: [] },
        })
      ).model;

      expect(
        agendaSnapshot(accepted, defaultDesktopPreferences()).events[0]?.rsvp
          ?.response
      ).toBe("accepted");

      const stale = update(
        accepted,
        Message.ReceivedEditing({ notice, personId: "another-person" })
      ).model;

      expect(stale).toBe(accepted);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);

it.effect(
  "a fresh-looking RSVP result from another person cannot advance handled IDs or trigger reads",
  () =>
    Effect.sync(() => {
      const base = upcomingFixture();

      const intent = RsvpIntent.make({
        event,
        id: 900,
        request: {
          accountId: event.accountId,
          calendarId: event.calendarId,
          eventId: event.eventId,
          response: "accepted",
          sendUpdates: "none",
        },
      });

      const notice = EditingNotice.cases.Rsvp.make({
        view: {
          ...base.editing.rsvp,
          result: Option.some(RsvpResult.cases.Saved.make({ event, intent })),
        },
      });

      const result = update(
        base,
        Message.ReceivedEditing({ notice, personId: "departed-person" })
      );

      expect(result.model.editing.handledResponse).toBe(
        base.editing.handledResponse
      );
      expect(result.model.editing.rsvp).toBe(base.editing.rsvp);
      expect(result.model.upcoming.request).toBe(base.upcoming.request);
      expect(result.commands ?? []).toEqual([]);
    })
);
