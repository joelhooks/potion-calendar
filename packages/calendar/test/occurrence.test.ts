import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Ref, Schema } from "effect";

import { readNeighborOccurrence } from "../src/capabilities.js";
import { GoogleCalendarClient } from "../src/google.js";
import { CalendarReadBudget } from "../src/sync.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const epoch = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-03-15T09:00:00Z")
);

const stamp = (minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(epoch + minutes * 60_000));

const instance = (
  id: string,
  start: number,
  original = start,
  series = "series"
) =>
  timedEvent(id, "Recurring meeting", {
    end: { dateTime: stamp(start + 10) },
    iCalUID: "series@fake.test",
    originalStartTime: { dateTime: stamp(original) },
    recurringEventId: series,
    start: { dateTime: stamp(start) },
  });

it.effect.prop(
  "next occurrence reads ordered same-series instances across a page tie and includes shorter overlapping events",
  {
    offset: Schema.Int.check(Schema.isBetween({ maximum: 90, minimum: 1 })),
  },
  ({ offset }) =>
    Effect.gen(function* nextOccurrence() {
      const anchor = {
        ...instance("anchor", 0),
        end: { dateTime: stamp(120) },
      };

      const best = instance("a-next", offset, 5);

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(200, {
          items: [
            anchor,
            instance("unrelated", 1, 1, "other-series"),
            instance("z-next", offset, 5),
          ],
          nextPageToken: "next-page",
        }),
        response(200, {
          items: [
            best,
            { id: "cancelled", status: "cancelled" },
            instance("farther", offset + 1),
          ],
        }),
      ]);

      const found = yield* readNeighborOccurrence
        .handler({ ...ref, direction: "next", eventId: "anchor" })
        .pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          )
        );

      expect(found?.eventId).toBe("a-next");
      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(3);

      const first = new URL(
        requests[1]?.path ?? "",
        "https://calendar.invalid"
      );

      expect(first.searchParams.get("iCalUID")).toBe("series@fake.test");
      expect(first.searchParams.get("orderBy")).toBe("startTime");
      expect(first.searchParams.get("singleEvents")).toBe("true");
      expect(first.searchParams.get("timeMin")).toBe(
        DateTime.formatIso(DateTime.makeUnsafe(epoch - 1))
      );
      expect(
        new URL(
          requests[2]?.path ?? "",
          "https://calendar.invalid"
        ).searchParams.get("pageToken")
      ).toBe("next-page");
    })
);

it.effect.prop(
  "previous occurrence scans every bounded page and chooses displayed-start then original-time then id rather than provider order",
  {
    offset: Schema.Int.check(Schema.isBetween({ maximum: 90, minimum: 1 })),
  },
  ({ offset }) =>
    Effect.gen(function* previousOccurrence() {
      const anchor = instance("anchor", 0);

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(200, {
          items: [
            instance("farther", -offset - 1),
            instance("a-previous", -offset, -100),
          ],
          nextPageToken: "last-page",
        }),
        response(200, {
          items: [
            instance("z-previous", -offset, -100),
            instance("wrong-series", -1, -1, "other-series"),
            anchor,
            { id: "cancelled", status: "cancelled" },
          ],
        }),
      ]);

      const found = yield* readNeighborOccurrence
        .handler({ ...ref, direction: "previous", eventId: "anchor" })
        .pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          )
        );

      expect(found?.eventId).toBe("z-previous");
      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(3);

      const first = new URL(
        requests[1]?.path ?? "",
        "https://calendar.invalid"
      );

      expect(first.pathname).toContain("/events/series/instances");
      expect(first.searchParams.get("timeMax")).toBe(
        DateTime.formatIso(DateTime.makeUnsafe(epoch + 1))
      );
      expect(
        new URL(
          requests[2]?.path ?? "",
          "https://calendar.invalid"
        ).searchParams.get("timeMax")
      ).toBe(first.searchParams.get("timeMax"));
    })
);

it.effect.prop(
  "only complete scans can report an absent neighboring occurrence",
  {
    direction: Schema.Literals(["next", "previous"]),
    incomplete: Schema.Boolean,
  },
  ({ direction, incomplete }) =>
    Effect.gen(function* absentOccurrence() {
      const anchor = instance("anchor", 0);

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(
          200,
          incomplete
            ? {
                items: [anchor, { id: "cancelled", status: "cancelled" }],
                nextPageToken: "more",
              }
            : { items: [anchor, { id: "cancelled", status: "cancelled" }] }
        ),
      ]);

      const read = readNeighborOccurrence
        .handler({ ...ref, direction, eventId: "anchor" })
        .pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          ),
          Effect.provideService(CalendarReadBudget, { maxPages: 1 })
        );

      if (incomplete) {
        const failure = yield* Effect.flip(read);
        expect(failure._tag).toBe("CalendarReadFailure");
        expect(failure.cause._tag).toBe("Provider");
        expect(failure).toHaveProperty(
          "cause.message",
          `Couldn't find the ${direction} occurrence`
        );
      } else {
        expect(yield* read).toBeNull();
      }
    })
);

it.effect.prop(
  "a repeated instances token is a typed read failure rather than an absent or partial result",
  {
    direction: Schema.Literals(["next", "previous"]),
  },
  ({ direction }) =>
    Effect.gen(function* repeatedToken() {
      const anchor = instance("anchor", 0);

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(200, { items: [], nextPageToken: "same" }),
        response(200, { items: [], nextPageToken: "same" }),
      ]);

      const failure = yield* Effect.flip(
        readNeighborOccurrence
          .handler({ ...ref, direction, eventId: "anchor" })
          .pipe(
            Effect.provide(
              GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
            )
          )
      );

      expect(failure._tag).toBe("CalendarReadFailure");
      expect(failure.cause._tag).toBe("Provider");
      expect(yield* Ref.get(fake.requests)).toHaveLength(3);
    })
);

it.effect.prop(
  "missing recurring identity or usable times fail before scanning instead of inventing absence",
  {
    invalid: Schema.Literals(["uid", "series", "time"]),
  },
  ({ invalid }) =>
    Effect.gen(function* missingOccurrenceIdentity() {
      const anchor = instance("anchor", 0);

      const variants = {
        series: { ...anchor, recurringEventId: "" },
        time: {
          ...anchor,
          originalStartTime: { dateTime: "2026-13-99T12:00:00Z" },
        },
        uid: { ...anchor, iCalUID: "" },
      };

      const fake = yield* fakeGoogle([response(200, variants[invalid])]);

      const failure = yield* Effect.flip(
        readNeighborOccurrence
          .handler({ ...ref, direction: "next", eventId: "anchor" })
          .pipe(
            Effect.provide(
              GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
            )
          )
      );

      expect(failure._tag).toBe("CalendarReadFailure");
      expect(failure.cause._tag).toBe("Provider");
      expect(yield* Ref.get(fake.requests)).toHaveLength(1);
    })
);

it.effect.prop(
  "a candidate on an incomplete boundary page does not become a nearest-occurrence result",
  {
    direction: Schema.Literals(["next", "previous"]),
  },
  ({ direction }) =>
    Effect.gen(function* incompleteCandidate() {
      const anchor = instance("anchor", 0);

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(200, {
          items: [instance("candidate", direction === "next" ? 1 : -1)],
          nextPageToken: "unread",
        }),
      ]);

      const failure = yield* Effect.flip(
        readNeighborOccurrence
          .handler({ ...ref, direction, eventId: "anchor" })
          .pipe(
            Effect.provide(
              GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
            ),
            Effect.provideService(CalendarReadBudget, { maxPages: 1 })
          )
      );

      expect(failure._tag).toBe("CalendarReadFailure");
      expect(failure.cause._tag).toBe("Provider");
      expect(yield* Ref.get(fake.requests)).toHaveLength(2);
    })
);
