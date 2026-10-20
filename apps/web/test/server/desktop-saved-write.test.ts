import {
  CalendarEvent,
  CalendarRef,
  CreateEventInput,
  ListCalendarsOutput,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";

import { initialModel, Message, update } from "../../src/client/app.js";
import { agendaSnapshot } from "../../src/client/desktop/snapshot.js";
import { makeDevelopmentBackend } from "../../src/dev/backend.js";
import { createDraft } from "../../src/layout/editor-draft.js";
import { draftEventFields } from "../../src/layout/editor-fields.js";
import { rpcDocument, rpcValue } from "./calendar-rpc.js";

const savedDesktopWrite = Effect.fn("savedDesktopWrite")(
  function* savedDesktopWrite(clearRepeat: boolean) {
    const backend = makeDevelopmentBackend("http://calendar.test");

    const listed = (yield* Schema.decodeUnknownEffect(
      rpcValue(ListCalendarsOutput)
    )(yield* rpcDocument(backend, "listCalendars")))[0].exit.value;

    const listing = yield* Schema.decodeEffect(ListCalendarsOutput)(listed);

    const calendars = listing.accounts.flatMap((account) =>
      "calendars" in account ? account.calendars : []
    );

    const [ref] = yield* Schema.decodeUnknownEffect(
      Schema.NonEmptyArray(CalendarRef)
    )(calendars);

    const now = DateTime.makeUnsafe("2026-10-24T10:00:00Z");
    const start = DateTime.formatIso(DateTime.add(now, { minutes: 20 }));
    const end = DateTime.formatIso(DateTime.add(now, { minutes: 50 }));

    const draft = yield* createDraft({
      allDay: false,
      endDate: end.slice(0, 10),
      endTime: end.slice(11, 16),
      ref,
      startDate: start.slice(0, 10),
      startTime: start.slice(11, 16),
      timeZone: "UTC",
    });

    const fields = yield* draftEventFields({
      ...draft,
      title: "Saved no-guest meeting",
    });

    expect(fields.recurrence).toEqual([]);

    const input = yield* Schema.encodeEffect(
      Schema.toCodecJson(CreateEventInput)
    )({
      ...ref,
      event: clearRepeat
        ? { ...fields, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"] }
        : fields,
      id: "abcd1234",
      sendUpdates: "none",
    });

    const created = (yield* Schema.decodeUnknownEffect(rpcValue(CalendarEvent))(
      yield* rpcDocument(backend, "createEvent", input)
    ))[0].exit.value;

    expect(created.attendees ?? []).toHaveLength(0);
    const base = initialModel(DateTime.toEpochMillis(now), "UTC");

    const selected = update(
      { ...base, person: Option.some("proof-person") },
      Message.ReceivedCalendars({ result: listing })
    ).model;

    const query = Option.getOrThrow(selected.upcoming.query);

    if (clearRepeat) {
      const before = (yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(
        yield* rpcDocument(backend, "listEvents", {
          calendars: query.calendars,
          range: query.range,
        })
      ))[0].exit.value;

      expect(
        before.events.some((event) => event.eventId === created.eventId)
      ).toBe(false);

      const patched = (yield* Schema.decodeUnknownEffect(
        rpcValue(CalendarEvent)
      )(
        yield* rpcDocument(backend, "updateEvent", {
          ...ref,
          changes: { recurrence: [] },
          eventId: created.eventId,
          removeRecurrence: true,
          scope: "all",
          sendUpdates: "none",
        })
      ))[0].exit.value;

      expect(patched.recurrence ?? []).toEqual([]);
    }

    const saved = (yield* Schema.decodeUnknownEffect(
      rpcValue(ListEventsOutput)
    )(
      yield* rpcDocument(backend, "listEvents", {
        calendars: query.calendars,
        range: query.range,
      })
    ))[0].exit.value;

    const received = update(
      selected,
      Message.ReceivedUpcoming({
        personId: "proof-person",
        request: query.request,
        result: saved,
      })
    ).model;

    const snapshot = agendaSnapshot(received, defaultDesktopPreferences());
    expect(
      snapshot.events.find((event) => event.key.eventId === created.eventId)
    ).toMatchObject({
      hasParticipants: false,
      key: {
        accountId: created.accountId,
        calendarId: created.calendarId,
        eventId: created.eventId,
      },
      start: DateTime.toEpochMillis(DateTime.makeUnsafe(start)),
      title: "Saved no-guest meeting",
    });
  }
);

it.effect(
  "a saved no-guest editor event at now plus twenty minutes survives a fresh upcoming read and default desktop projection",
  () => savedDesktopWrite(false)
);

it.effect(
  "a recurring master stays out of expanded reads until clearing its recurrence makes it a regular saved desktop event",
  () => savedDesktopWrite(true)
);
