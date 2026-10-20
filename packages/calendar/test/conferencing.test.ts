import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarService } from "../src/calendar.js";
import { ConferencingRefused } from "../src/conferencing-refused.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { CalendarStore } from "../src/store.js";
import { GoogleRetryPolicy } from "../src/transport.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const eventRef = { ...ref, eventId: "abcde" };

const fields = {
  end: { dateTime: "2026-10-20T11:00:00Z" },
  start: { dateTime: "2026-10-20T10:00:00Z" },
  title: "Meeting",
};

const bodySchema = Schema.fromJsonString(
  Schema.Struct({
    conferenceData: Schema.Struct({
      createRequest: Schema.Struct({
        conferenceSolutionKey: Schema.Struct({
          type: Schema.Literal("hangoutsMeet"),
        }),
        requestId: Schema.NonEmptyString,
      }),
    }),
  })
);

const providerEvent = (
  statusCode: "pending" | "success" | "failure",
  uri = "https://meet.google.com/read-back"
) =>
  timedEvent("abcde", "Provider readback", {
    conferenceData: {
      createRequest: { status: { statusCode } },
      entryPoints: [{ entryPointType: "video", uri }],
    },
  });

const clientLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  GoogleCalendarClient.layer.pipe(Layer.provideMerge(fake.layer));

const serviceLayer = (fake: Effect.Success<ReturnType<typeof fakeGoogle>>) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(
      clientLayer(fake).pipe(Layer.provideMerge(memoryCalendarStore))
    )
  );

describe("Google Meet provider boundary", () => {
  it.effect.prop(
    "create and patch return the readback status, never the write reply's apparent success",
    {
      email: Arbitrary.schema(Schema.Boolean),
      method: Arbitrary.schema(Schema.Literals(["create", "patch"])),
      statusCode: Arbitrary.schema(
        Schema.Literals(["pending", "success", "failure"])
      ),
    },
    ({ method, statusCode, email }) =>
      Effect.gen(function* conferencingProof() {
        const fake = yield* fakeGoogle([
          response(
            200,
            providerEvent("success", "https://meet.google.com/write-reply")
          ),
          response(200, providerEvent(statusCode)),
        ]);

        const event = yield* GoogleCalendarClient.use((google) =>
          method === "create"
            ? google.create(ref, "abcde", fields, {
                conferencingRequest: { kind: "googleMeet" },
                sendUpdates: email ? "all" : undefined,
              })
            : google.patch(eventRef, fields, {
                conferencingRequest: { kind: "googleMeet" },
                sendUpdates: email ? "all" : undefined,
              })
        ).pipe(Effect.provide(clientLayer(fake)));

        const expectedStatus = {
          failure: "failed",
          pending: "pending",
          success: "ready",
        }[statusCode];

        expect(event.conferencingStatus).toBe(expectedStatus);
        expect(event.conferenceUrl).toBe(
          statusCode === "success"
            ? "https://meet.google.com/read-back"
            : undefined
        );
        expect(event.title).toBe("Provider readback");
        const requests = yield* Ref.get(fake.requests);
        expect(requests.map((request) => request.method)).toEqual([
          method === "create" ? "POST" : "PATCH",
          "GET",
        ]);
        const [firstWrite] = requests;

        const write = yield* Effect.fromNullishOr(firstWrite).pipe(
          Effect.orDie
        );

        const url = new URL(write.path, "https://calendar.test");
        expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
        expect(url.searchParams.get("sendUpdates")).toBe(
          email ? "all" : "none"
        );
        const body = yield* Schema.decodeEffect(bodySchema)(write.body ?? "");
        expect(body.conferenceData.createRequest.requestId).toMatch(
          /^[a-f0-9-]{36}$/u
        );

        const wireBody = yield* Schema.decodeEffect(
          Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
        )(write.body ?? "{}");

        expect(wireBody).not.toHaveProperty("conferencingRequest");
      })
  );

  it.effect(
    "new creation requests have distinct ids, but an HTTP retry reuses the same id",
    () =>
      Effect.gen(function* conferencingProof() {
        const fake = yield* fakeGoogle([
          response(503),
          response(200, providerEvent("pending")),
          response(200, providerEvent("pending")),
          response(200, providerEvent("success")),
          response(200, providerEvent("success")),
        ]);

        yield* Effect.gen(function* conferencingScenario() {
          const google = yield* GoogleCalendarClient;
          yield* google.patch(
            eventRef,
            {},
            { conferencingRequest: { kind: "googleMeet" } }
          );
          yield* google.patch(
            eventRef,
            {},
            { conferencingRequest: { kind: "googleMeet" } }
          );
        }).pipe(
          Effect.provide(clientLayer(fake)),
          Effect.provideService(GoogleRetryPolicy, {
            baseDelayMs: 0,
            retries: 1,
          })
        );

        const writes = (yield* Ref.get(fake.requests)).filter(
          (request) => request.method === "PATCH"
        );

        expect(writes).toHaveLength(3);

        const bodies: (typeof bodySchema.Type)[] = [];

        for (const request of writes) {
          bodies.push(
            yield* Schema.decodeEffect(bodySchema)(request.body ?? "")
          );
        }

        expect(bodies[0]?.conferenceData.createRequest.requestId).toBe(
          bodies[1]?.conferenceData.createRequest.requestId
        );
        expect(bodies[1]?.conferenceData.createRequest.requestId).not.toBe(
          bodies[2]?.conferenceData.createRequest.requestId
        );
      })
  );

  it.effect("removal sends explicit null and reads the event back", () =>
    Effect.gen(function* conferencingProof() {
      const fake = yield* fakeGoogle([
        response(200, timedEvent("abcde")),
        response(200, timedEvent("abcde")),
      ]);

      const event = yield* GoogleCalendarClient.use((google) =>
        google.patch(eventRef, {}, { conferencingRequest: { kind: "none" } })
      ).pipe(Effect.provide(clientLayer(fake)));

      expect(event.conferenceUrl).toBeUndefined();
      const requests = yield* Ref.get(fake.requests);
      expect(requests.map((request) => request.method)).toEqual([
        "PATCH",
        "GET",
      ]);

      const wireBody = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
      )(requests[0]?.body ?? "{}");

      expect(wireBody).toEqual({ conferenceData: null });
      expect(
        new URL(
          requests[0]?.path ?? "",
          "https://calendar.test"
        ).searchParams.get("conferenceDataVersion")
      ).toBe("1");
    })
  );

  it.effect(
    "a committed write with failed readback remains unconfirmed rather than ready or a retryable event-creation failure",
    () =>
      Effect.gen(function* conferencingProof() {
        const fake = yield* fakeGoogle([
          response(200, providerEvent("success")),
          response(403),
        ]);

        const event = yield* GoogleCalendarClient.use((google) =>
          google.create(ref, "abcde", fields, {
            conferencingRequest: { kind: "googleMeet" },
          })
        ).pipe(Effect.provide(clientLayer(fake)));

        expect(event.conferencingStatus).toBe("unconfirmed");
        expect(event.eventId).toBe("abcde");
        expect(
          (yield* Ref.get(fake.requests)).map((request) => request.method)
        ).toEqual(["POST", "GET"]);
      })
  );

  it.effect(
    "a missing conference status or link is not reported as ready",
    () =>
      Effect.gen(function* conferencingProof() {
        const fake = yield* fakeGoogle([
          response(200, timedEvent("abcde")),
          response(
            200,
            timedEvent("abcde", "Incomplete", {
              conferenceData: {
                createRequest: { status: { statusCode: "success" } },
              },
            })
          ),
        ]);

        const event = yield* GoogleCalendarClient.use((google) =>
          google.patch(
            eventRef,
            {},
            { conferencingRequest: { kind: "googleMeet" } }
          )
        ).pipe(Effect.provide(clientLayer(fake)));

        expect(event.conferencingStatus).toBe("unconfirmed");
        expect(event.conferenceUrl).toBeUndefined();
      })
  );
});

it.effect.prop(
  "Meet capability refusal precedes every provider mutation; pending and failed receipts still invalidate the event cache",
  {
    accessRole: Arbitrary.schema(
      Schema.Literals(["owner", "writer", "reader", "freeBusyReader"])
    ),
    statusCode: Arbitrary.schema(Schema.Literals(["pending", "failure"])),
    support: Arbitrary.schema(
      Schema.Literals(["missing", "unsupported", "supported"])
    ),
  },
  ({ accessRole, support, statusCode }) =>
    Effect.gen(function* conferencingProof() {
      const allowed =
        (accessRole === "owner" || accessRole === "writer") &&
        support === "supported";

      const calendarResponse =
        support === "missing"
          ? response(200, { accessRole, id: ref.calendarId })
          : response(200, {
              accessRole,
              conferenceProperties: {
                allowedConferenceSolutionTypes:
                  support === "supported" ? ["hangoutsMeet"] : ["addOn"],
              },
              id: ref.calendarId,
            });

      const fake = yield* fakeGoogle([
        calendarResponse,
        ...(allowed
          ? [
              response(200, providerEvent("success")),
              response(200, providerEvent(statusCode)),
            ]
          : []),
      ]);

      yield* Effect.gen(function* conferencingScenario() {
        const calendar = yield* CalendarService;
        const store = yield* CalendarStore;

        if (allowed) {
          const event = yield* calendar.createEvent({
            ...ref,
            conferencingRequest: { kind: "googleMeet" },
            event: fields,
            id: "abcde",
          });

          expect(event.conferencingStatus).toBe(
            statusCode === "failure" ? "failed" : "pending"
          );
          expect((yield* store.read(ref)).version).toBe(1);
        } else {
          const error = yield* calendar
            .createEvent({
              ...ref,
              conferencingRequest: { kind: "googleMeet" },
              event: fields,
              id: "abcde",
            })
            .pipe(Effect.flip);

          expect(error).toEqual(
            new ConferencingRefused({
              ...ref,
              reason:
                accessRole === "reader" || accessRole === "freeBusyReader"
                  ? "calendarReadOnly"
                  : "calendarUnsupported",
            })
          );
          expect((yield* store.read(ref)).version).toBe(0);
        }
      }).pipe(
        Effect.provide(serviceLayer(fake)),
        Effect.provideService(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 })
      );
      expect(
        (yield* Ref.get(fake.requests)).map((request) => request.method)
      ).toEqual(allowed ? ["GET", "POST", "GET"] : ["GET"]);
    })
);
