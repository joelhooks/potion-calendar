import { equivalenceKey } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Match, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import type { CalendarEventValue, EventTimeValue } from "../src/model.js";
import { CalendarStore } from "../src/store.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const uidArbitrary = Arbitrary.schema(Schema.NonEmptyString);

const kinds = Arbitrary.schema(Schema.Literals(["single", "date", "instant"]));

const range = { end: "2026-04-01T00:00:00Z", start: "2026-03-01T00:00:00Z" };

const anchorFor = (
  kind: "single" | "date" | "instant",
  utc = false
): EventTimeValue | undefined =>
  Match.value(kind).pipe(
    Match.when("single", () => Option.none<EventTimeValue>()),
    Match.when("date", () =>
      Option.some<EventTimeValue>({ date: "2026-03-15" })
    ),
    Match.when("instant", () =>
      Option.some<EventTimeValue>(
        utc
          ? { dateTime: "2026-03-15T16:00:00Z", timeZone: "UTC" }
          : { dateTime: "2026-03-15T09:00:00-07:00" }
      )
    ),
    Match.exhaustive,
    Option.getOrUndefined
  );

const event = (
  iCalUID: string | undefined,
  originalStartTime?: EventTimeValue
): CalendarEventValue => ({
  ...ref,
  eventId: "event",
  iCalUID,
  originalStartTime,
  recurringEventId: originalStartTime === undefined ? undefined : "series",
  start: { dateTime: "2026-03-15T16:00:00Z" },
  status: "confirmed",
  title: "Meeting",
});

it.prop(
  "copies across accounts keep one key despite event ids, titles, current times, or offset representations",
  { kind: kinds, uid: uidArbitrary },
  ({ uid, kind }) => {
    const original = anchorFor(kind);
    const copyOriginal = anchorFor(kind, true);

    const first = event(uid, original);

    const copy = {
      ...event(uid, copyOriginal),
      accountId: "other-account",
      calendarId: "other-calendar",
      eventId: "other-copy",
      start: { dateTime: "2026-03-17T17:00:00Z" },
      title: "Changed title",
    };

    const key = equivalenceKey(first);
    expect(key).toBeDefined();
    expect(equivalenceKey(copy)).toBe(key);
    expect(
      equivalenceKey({ ...copy, iCalUID: `${uid}\u0000different` })
    ).not.toBe(key);
  }
);

it.prop(
  "different instances of one series have distinct keys even when moved to the same current time",
  { allDay: Arbitrary.schema(Schema.Boolean), uid: uidArbitrary },
  ({ uid, allDay }) => {
    const first = event(
      uid,
      allDay ? { date: "2026-03-15" } : { dateTime: "2026-03-15T16:00:00Z" }
    );

    const second = event(
      uid,
      allDay ? { date: "2026-03-22" } : { dateTime: "2026-03-22T16:00:00Z" }
    );

    expect(equivalenceKey(first)).toBeDefined();
    expect(equivalenceKey(second)).toBeDefined();
    expect(equivalenceKey(first)).not.toBe(equivalenceKey(second));
    expect(equivalenceKey(first)).not.toBe(equivalenceKey(event(uid)));
  }
);

it.prop(
  "missing invitation identity never falls back to title or current time",
  { kind: kinds, title: Arbitrary.schema(Schema.String) },
  ({ title, kind }) => {
    const original = anchorFor(kind);

    expect(
      equivalenceKey({ ...event(undefined, original), title })
    ).toBeUndefined();
    expect(equivalenceKey({ ...event("", original), title })).toBeUndefined();
  }
);

it.prop(
  "instances with no original anchor do not collapse into the series key",
  { uid: uidArbitrary },
  ({ uid }) => {
    expect(
      equivalenceKey({ ...event(uid), recurringEventId: "series" })
    ).toBeUndefined();
    expect(
      equivalenceKey(event(uid, { dateTime: "2026-03-15TinvalidZ" }))
    ).toBeUndefined();
  }
);

it.prop(
  "all-day dates and timed instants remain different identity domains",
  { uid: uidArbitrary },
  ({ uid }) => {
    expect(equivalenceKey(event(uid, { date: "2026-03-15" }))).not.toBe(
      equivalenceKey(event(uid, { dateTime: "2026-03-15T00:00:00Z" }))
    );
  }
);

it.effect.prop(
  "Google mapping and memory range caching preserve UID and original start",
  { allDay: Arbitrary.schema(Schema.Boolean), uid: uidArbitrary },
  ({ uid, allDay }) =>
    Effect.gen(function* mappedInvitationIdentity() {
      const original = allDay
        ? { date: "2026-03-15" }
        : {
            dateTime: "2026-03-15T09:00:00-07:00",
            timeZone: "America/Los_Angeles",
          };

      const fake = yield* fakeGoogle([
        response(
          200,
          timedEvent("instance", "Meeting", {
            iCalUID: uid,
            originalStartTime: original,
            recurringEventId: "series",
          })
        ),
      ]);

      const layer = Layer.merge(
        GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
        memoryCalendarStore
      );

      yield* Effect.gen(function* verifyMappedCopy() {
        const google = yield* GoogleCalendarClient;
        const store = yield* CalendarStore;
        const mapped = yield* google.get({ ...ref, eventId: "instance" });
        expect(mapped.iCalUID).toBe(uid);
        expect(mapped.originalStartTime).toEqual(original);
        expect(yield* store.cacheRange(ref, range, 0, [mapped])).toBe(true);
        const cached = yield* store.readRange(ref, range, 0);
        expect(cached).toEqual([mapped]);
        expect(cached?.[0]?.iCalUID).toBe(uid);
        expect(cached?.[0]?.originalStartTime).toEqual(original);
        expect(equivalenceKey(mapped)).toBe(
          equivalenceKey(event(uid, original))
        );
      }).pipe(Effect.provide(layer));
    })
);
