import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarService } from "../src/calendar.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const bodySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const serviceLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(GoogleCalendarClient.layer),
    Layer.provide(Layer.merge(fake.layer, memoryCalendarStore))
  );

const guests = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: 1 }))
);

const instance = timedEvent("instance", "Before", {
  originalStartTime: { dateTime: "2026-03-15T09:00:00-07:00" },
  recurringEventId: "master",
});

const master = timedEvent("master", "Before", {
  recurrence: ["RRULE:FREQ=WEEKLY"],
});

describe("implicit provider field preservation", () => {
  it.effect.prop(
    "replacement attendees retain only the latest matching source rows' unmodeled fields",
    { additionalGuests: guests, value: Arbitrary.schema(Schema.String) },
    ({ additionalGuests, value }) =>
      Effect.gen(function* preserveRetainedAttendees() {
        const retained = { email: "keep@example.test", optional: true };
        const added = { email: "new@example.test", optional: false };
        const source = timedEvent("event", "Before");

        const latest = timedEvent("event", "Before", {
          attendees: [
            {
              additionalGuests,
              email: "  KEEP@EXAMPLE.TEST  ",
              id: "provider-attendee",
              optional: false,
              providerOnly: { value },
            },
            {
              additionalGuests: 100,
              email: "removed@example.test",
              providerOnly: { removed: true },
            },
          ],
        });

        const fake = yield* fakeGoogle([
          response(200, source),
          response(200, latest),
          response(200, timedEvent("event", "After")),
        ]);

        yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { attendees: [retained, added] },
            eventId: "event",
            scope: "single",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));

        const requests = yield* Ref.get(fake.requests);
        const patch = requests.find((request) => request.method === "PATCH");
        const body = yield* Schema.decodeEffect(bodySchema)(patch?.body ?? "");

        expect(body).toEqual({
          attendees: [
            {
              ...retained,
              additionalGuests,
              id: "provider-attendee",
              providerOnly: { value },
            },
            added,
          ],
        });
        expect(requests.map((request) => request.method)).toEqual([
          "GET",
          "GET",
          "PATCH",
        ]);
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );

  it.effect.prop(
    "Following successors carry the latest master's private and shared properties, source and gadget verbatim",
    { additionalGuests: guests, value: Arbitrary.schema(Schema.String) },
    ({ additionalGuests, value }) =>
      Effect.gen(function* preserveFollowingFields() {
        const metadata = {
          extendedProperties: {
            private: { integration: value },
            shared: { binding: "shared", future: value },
          },
          gadget: { preferences: { future: value }, title: "Provider gadget" },
          source: { title: value, url: "https://example.test/source" },
        };

        const latest = {
          ...master,
          ...metadata,
          attendees: [
            { additionalGuests, email: "keep@example.test", future: { value } },
          ],
        };

        const original = {
          ...master,
          attendees: [{ email: "keep@example.test" }],
          extendedProperties: { private: { stale: "not the latest read" } },
        };

        const fake = yield* fakeGoogle([
          response(200, instance),
          response(200, original),
          response(200, latest),
          response(200, timedEvent("successor", "After")),
          response(200, master),
        ]);

        yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "After" },
            eventId: "instance",
            scope: "allFollowing",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));

        const requests = yield* Ref.get(fake.requests);
        const insert = requests.find((request) => request.method === "POST");
        const body = yield* Schema.decodeEffect(bodySchema)(insert?.body ?? "");

        expect(body).toEqual({
          ...metadata,
          attachments: [],
          attendees: latest.attendees,
          end: instance.end,
          id: "5gs3im3rr9eibpmr7q7i3evfklbcfkoqkp32mv3mgl6fkv7u592g",
          recurrence: ["RRULE:FREQ=WEEKLY"],
          start: instance.start,
          summary: "After",
        });
        expect(requests.map((request) => request.method)).toEqual([
          "GET",
          "GET",
          "GET",
          "POST",
          "PATCH",
        ]);

        const truncated = yield* Schema.decodeEffect(bodySchema)(
          requests.at(-1)?.body ?? ""
        );

        expect(Object.keys(truncated)).toEqual(["recurrence"]);
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );

  it.effect(
    "ordinary title PATCH neither copies hidden metadata nor adds a preservation read",
    () =>
      Effect.gen(function* unchangedPatchBoundary() {
        const fake = yield* fakeGoogle([
          response(200, {
            ...master,
            attendees: [{ additionalGuests: 4, email: "keep@example.test" }],
            extendedProperties: { private: { hidden: "private" } },
            gadget: { title: "Hidden" },
            source: { title: "Source", url: "https://example.test/source" },
          }),
          response(200, timedEvent("master", "After")),
        ]);

        const saved = yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "After" },
            eventId: "master",
            scope: "all",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));

        const requests = yield* Ref.get(fake.requests);
        expect(requests.map((request) => request.method)).toEqual([
          "GET",
          "PATCH",
        ]);
        expect(
          yield* Schema.decodeEffect(bodySchema)(requests.at(-1)?.body ?? "")
        ).toEqual({ summary: "After" });
        expect(saved).not.toHaveProperty("extendedProperties");
        expect(saved).not.toHaveProperty("source");
        expect(saved).not.toHaveProperty("gadget");
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );

  it.effect(
    "a failed last-moment master read prevents successor creation and truncation",
    () =>
      Effect.gen(function* failedPreservationRead() {
        const fake = yield* fakeGoogle([
          response(200, instance),
          response(200, master),
          response(403),
        ]);

        const failure = yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "After" },
            eventId: "instance",
            scope: "allFollowing",
          })
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure._tag).toBe("Provider");
        expect(
          (yield* Ref.get(fake.requests)).map((request) => request.method)
        ).toEqual(["GET", "GET", "GET"]);
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );

  it.effect(
    "provider-only values never enter the event returned to the browser contract",
    () =>
      Effect.gen(function* rawValuesStayServerSide() {
        const fake = yield* fakeGoogle([
          response(200, {
            ...master,
            attendees: [
              {
                additionalGuests: 4,
                email: "keep@example.test",
                providerOnly: { private: "not client data" },
              },
            ],
            extendedProperties: { private: { hidden: "not client data" } },
            gadget: { title: "Hidden" },
            source: { title: "Source", url: "https://example.test/source" },
          }),
        ]);

        const event = yield* CalendarService.use((calendar) =>
          calendar.getEvent({ ...ref, eventId: "master" })
        ).pipe(Effect.provide(serviceLayer(fake)));

        expect(event.attendees).toEqual([{ email: "keep@example.test" }]);
        expect(event).not.toHaveProperty("extendedProperties");
        expect(event).not.toHaveProperty("source");
        expect(event).not.toHaveProperty("gadget");
        expect(JSON.stringify(event)).not.toContain("not client data");
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );

  it.effect(
    "Following without provider metadata invents no hidden fields",
    () =>
      Effect.gen(function* absentMetadata() {
        const fake = yield* fakeGoogle([
          response(200, instance),
          response(200, master),
          response(200, master),
          response(200, timedEvent("successor", "After")),
          response(200, master),
        ]);

        yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: { title: "After" },
            eventId: "instance",
            scope: "allFollowing",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));

        const insert = (yield* Ref.get(fake.requests)).find(
          (request) => request.method === "POST"
        );

        const body = yield* Schema.decodeEffect(bodySchema)(insert?.body ?? "");

        expect(body).not.toHaveProperty("extendedProperties");
        expect(body).not.toHaveProperty("source");
        expect(body).not.toHaveProperty("gadget");
        expect(body).not.toHaveProperty("attendees");
        expect(yield* Ref.get(fake.pending)).toEqual([]);
      })
  );
});
