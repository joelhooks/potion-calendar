import { Calendar, CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { prepareClipboardCut } from "../src/client/clipboard/cut.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { clipboardSource } from "./clipboard-fixture.js";
import { clipboardTarget } from "./clipboard-runtime-fixture.js";

it.effect.prop(
  "Cut rebases only the captured provider reference and refuses missing or read-only originals instead of deleting an equivalent representative",
  {
    available: Schema.Boolean,
    sourceFirst: Schema.Boolean,
    writable: Schema.Boolean,
  },
  ({ available, sourceFirst, writable }) =>
    Effect.gen(function* capturedOriginal() {
      const original = CalendarEvent.make({
        ...clipboardSource,
        title: "Updated after Copy",
      });

      const other = CalendarEvent.make({
        ...clipboardSource,
        accountId: "other-account",
        calendarId: "other-calendar",
        eventId: "equivalent-event",
      });

      const calendars = [
        Calendar.make({
          ...clipboardTarget.calendar,
          accessRole: writable ? "owner" : "reader",
        }),
        Calendar.make({
          ...clipboardTarget.calendar,
          accountId: other.accountId,
          calendarId: other.calendarId,
        }),
      ];

      const candidates = sourceFirst ? [original, other] : [other, original];
      const events = available ? candidates : [other];

      const prepared = prepareClipboardCut({
        calendars,
        events,
        navigation: initialNavigation(dayFromIso("2026-10-19")),
        primaryZone: "America/Los_Angeles",
        selection: Option.some("shared-equivalent-group"),
        source: {
          accountId: clipboardSource.accountId,
          calendarId: clipboardSource.calendarId,
          eventId: clipboardSource.eventId,
        },
      });

      if (available && writable) {
        const request = yield* prepared;
        expect(request.mode).toBe("delete");
        expect(request.event).toMatchObject({
          accountId: original.accountId,
          calendarId: original.calendarId,
          eventId: original.eventId,
          title: "Updated after Copy",
        });
      } else {
        const failure = yield* prepared.pipe(Effect.flip);
        expect(failure.reason).toBe(
          writable ? "missingSource" : "readOnlySource"
        );
        expect(failure.source).toMatchObject({
          accountId: original.accountId,
          calendarId: original.calendarId,
          eventId: original.eventId,
        });
      }
    })
);
