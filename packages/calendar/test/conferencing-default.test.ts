import { expect, it } from "@effect/vitest";
import { Effect, Layer, Match, Ref, Schema } from "effect";

import { CalendarService } from "../src/calendar.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const fields = {
  end: { dateTime: "2026-10-20T11:00:00Z" },
  start: { dateTime: "2026-10-20T10:00:00Z" },
};

const raw = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

const calendar = response(200, {
  accessRole: "owner",
  conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
  id: ref.calendarId,
});

const serviceLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(
        Layer.provideMerge(Layer.merge(fake.layer, memoryCalendarStore))
      )
    )
  );

it.effect.prop(
  "only an explicit account Meet default on an eligible new event adds conferencing; self, resources, links, None and unset suppress it",
  {
    mode: Schema.Literals([
      "human",
      "self",
      "resource",
      "existingLink",
      "explicitNone",
    ]),
    setting: Schema.Literals(["unset", "none", "googleMeet"]),
  },
  ({ setting, mode }) =>
    Effect.gen(function* newEventDefault() {
      const automatic = setting === "googleMeet" && mode === "human";

      const attendee = Match.value(mode).pipe(
        Match.when("self", () => ({ email: "OWNER@EXAMPLE.TEST" })),
        Match.when("resource", () => ({
          email: "room@example.test",
          resource: true,
        })),
        Match.orElse(() => ({ email: "guest@example.test" }))
      );

      const responses = [
        ...(automatic ? [calendar] : []),
        response(200, timedEvent("abcde")),
      ];

      if (automatic) {
        responses.push(
          response(
            200,
            timedEvent("abcde", "Meeting", {
              conferenceData: {
                createRequest: { status: { statusCode: "pending" } },
              },
            })
          )
        );
      } else if (mode === "explicitNone") {
        responses.push(response(200, timedEvent("abcde")));
      }

      const fake = yield* fakeGoogle(responses, undefined, setting);

      const event = yield* CalendarService.use((service) =>
        service.createEvent({
          ...ref,
          conferencingRequest:
            mode === "explicitNone" ? { kind: "none" } : undefined,
          event: {
            ...fields,
            attendees: [attendee],
            location:
              mode === "existingLink" ? "https://zoom.us/j/1234" : undefined,
          },
          id: "abcde",
        })
      ).pipe(Effect.provide(serviceLayer(fake)));

      expect(event.conferencingStatus).toBe(automatic ? "pending" : undefined);

      const requests = yield* Ref.get(fake.requests);

      const write = yield* Effect.fromNullishOr(
        requests.find((request) => request.method === "POST")
      ).pipe(Effect.orDie);

      const body = yield* Schema.decodeEffect(raw)(write.body ?? "{}");

      if (automatic) {
        expect(body.conferenceData).toMatchObject({
          createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
        });
      } else if (mode === "explicitNone") {
        expect(body.conferenceData).toBeNull();
      } else {
        expect(body).not.toHaveProperty("conferenceData");
      }

      expect(
        new URL(write.path, "https://calendar.test").searchParams.get(
          "sendUpdates"
        )
      ).toBe("none");
    })
);

it.effect(
  "an existing event gaining its first guest never applies the account default",
  () =>
    Effect.gen(function* existingEventDefault() {
      const fake = yield* fakeGoogle(
        [
          response(200, timedEvent("abcde")),
          response(200, timedEvent("abcde")),
          response(200, timedEvent("abcde")),
        ],
        undefined,
        "googleMeet"
      );

      yield* CalendarService.use((service) =>
        service.updateEvent({
          ...ref,
          changes: { attendees: [{ email: "guest@example.test" }] },
          eventId: "abcde",
          scope: "single",
        })
      ).pipe(Effect.provide(serviceLayer(fake)));

      const writes = (yield* Ref.get(fake.requests)).filter(
        (request) => request.method === "PATCH"
      );

      expect(writes).toHaveLength(1);

      const body = yield* Schema.decodeEffect(raw)(writes[0]?.body ?? "{}");
      expect(body).not.toHaveProperty("conferenceData");
    })
);
