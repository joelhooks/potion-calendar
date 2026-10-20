import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Schema } from "effect";

import { CalendarService } from "../src/calendar.js";
import { ConferencingRefused } from "../src/conferencing-refused.js";
import { CreateEventInput } from "../src/contracts.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { OwnedConference } from "../src/owned-conference.js";
import { CalendarStore } from "../src/store.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const nativeConference = {
  conferenceId: "aaa-bbbb-ccc",
  conferenceSolution: {
    iconUri: "https://example.test/meet-icon.png",
    key: { type: "hangoutsMeet" },
    name: "Google Meet",
  },
  entryPoints: [
    {
      entryPointType: "video",
      label: "Meet",
      uri: "https://meet.google.com/aaa-bbbb-ccc",
    },
    { entryPointType: "phone", pin: "1234", uri: "tel:+15550001111,,,1234" },
  ],
  notes: "Fixture series instructions",
  signature: "fixture-conference-signature",
};

const start = {
  dateTime: "2026-03-15T09:00:00-07:00",
  timeZone: "America/Los_Angeles",
};

const selected = (conferenceData: Schema.Json) =>
  timedEvent("instance", "Original", {
    conferenceData,
    originalStartTime: start,
    recurringEventId: "master",
  });

const master = (conferenceData: Schema.Json) =>
  timedEvent("master", "Original", {
    conferenceData,
    recurrence: ["RRULE:FREQ=WEEKLY"],
    start: {
      dateTime: "2026-03-01T09:00:00-08:00",
      timeZone: "America/Los_Angeles",
    },
  });

const serviceLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(
        Layer.provideMerge(Layer.merge(fake.layer, memoryCalendarStore))
      )
    )
  );

const body = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

it.effect.prop(
  "a Following edit preserves the original conference identity, entry points and signature without creating another Meet",
  { title: Schema.String },
  ({ title }) =>
    Effect.gen(function* preserveFollowing() {
      const original = {
        ...nativeConference,
        createRequest: {
          requestId: "old-request",
          status: { statusCode: "success" },
        },
      };

      const successor = timedEvent("successor", title, {
        conferenceData: nativeConference,
      });

      const fake = yield* fakeGoogle([
        response(200, selected(original)),
        response(200, master(original)),
        response(200, successor),
        response(200, successor),
        response(200, master(original)),
      ]);

      const event = yield* CalendarService.use((calendar) =>
        calendar.updateEvent({
          ...ref,
          changes: { title },
          eventId: "instance",
          scope: "allFollowing",
        })
      ).pipe(Effect.provide(serviceLayer(fake)));

      expect(event.conference).toMatchObject({
        id: "aaa-bbbb-ccc",
        kind: "googleMeet",
      });
      expect(event.conferenceUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");
      expect(event.conferencingStatus).toBe("ready");

      const requests = yield* Ref.get(fake.requests);
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "POST",
        "GET",
        "PATCH",
      ]);

      const insert = yield* Effect.fromNullishOr(
        requests.find((request) => request.method === "POST")
      ).pipe(Effect.orDie);

      const written = yield* Schema.decodeEffect(body)(insert.body ?? "{}");
      expect(written.conferenceData).toEqual(nativeConference);
      expect(
        new URL(insert.path, "https://calendar.test").searchParams.get(
          "conferenceDataVersion"
        )
      ).toBe("1");
      expect(
        new URL(insert.path, "https://calendar.test").searchParams.get(
          "sendUpdates"
        )
      ).toBe("none");

      const truncate = yield* Effect.fromNullishOr(
        requests.find((request) => request.method === "PATCH")
      ).pipe(Effect.orDie);

      const truncated = yield* Schema.decodeEffect(body)(truncate.body ?? "{}");
      expect(truncated).not.toHaveProperty("conferenceData");
      expect(yield* Ref.get(fake.pending)).toEqual([]);
    })
);

it.effect(
  "unrepresentable existing conferencing refuses Following before creating or truncating either series",
  () =>
    Effect.gen(function* unrepresentableFollowing() {
      const incomplete = { conferenceSolution: { key: { type: "addOn" } } };

      const fake = yield* fakeGoogle([
        response(200, selected(incomplete)),
        response(200, master(incomplete)),
      ]);

      yield* Effect.gen(function* refusedMutation() {
        const calendar = yield* CalendarService;
        const store = yield* CalendarStore;

        const error = yield* calendar
          .updateEvent({
            ...ref,
            changes: { title: "Changed" },
            eventId: "instance",
            scope: "allFollowing",
          })
          .pipe(Effect.flip);

        expect(error).toEqual(
          new ConferencingRefused({
            ...ref,
            reason: "existingConferenceUnrepresentable",
          })
        );
        expect((yield* store.read(ref)).version).toBe(0);
      }).pipe(Effect.provide(serviceLayer(fake)));

      expect(
        (yield* Ref.get(fake.requests)).map((request) => request.method)
      ).toEqual(["GET", "GET"]);
    })
);

it.effect(
  "explicit removal bypasses preservation of an unrepresentable conference",
  () =>
    Effect.gen(function* removeUnrepresentable() {
      const incomplete = { conferenceSolution: { key: { type: "addOn" } } };
      const successor = timedEvent("successor");

      const fake = yield* fakeGoogle([
        response(200, selected(incomplete)),
        response(200, master(incomplete)),
        response(200, successor),
        response(200, successor),
        response(200, master(incomplete)),
      ]);

      yield* CalendarService.use((calendar) =>
        calendar.updateEvent({
          ...ref,
          changes: { title: "Changed" },
          conferencingRequest: { kind: "none" },
          eventId: "instance",
          scope: "allFollowing",
        })
      ).pipe(Effect.provide(serviceLayer(fake)));

      const insert = yield* Effect.fromNullishOr(
        (yield* Ref.get(fake.requests)).find(
          (request) => request.method === "POST"
        )
      ).pipe(Effect.orDie);

      expect(
        (yield* Schema.decodeEffect(body)(insert.body ?? "{}")).conferenceData
      ).toBeNull();
    })
);

it.effect(
  "the public creation contract cannot request an internal conference copy",
  () =>
    Effect.gen(function* privatePreservationOperation() {
      const conference = yield* Schema.decodeEffect(OwnedConference)({
        entryPoints: [
          { kind: "video", uri: "https://meet.google.com/aaa-bbbb-ccc" },
        ],
        id: "aaa-bbbb-ccc",
        kind: "googleMeet",
      });

      const decoded = Schema.decodeUnknownOption(CreateEventInput)({
        ...ref,
        conferencingRequest: { conference, kind: "keepExisting" },
        event: {
          end: { dateTime: "2026-03-15T18:00:00Z" },
          start: { dateTime: "2026-03-15T17:00:00Z" },
        },
        id: "abcde",
      });

      expect(Option.isNone(decoded)).toBe(true);
    })
);
