import { GoogleTokens, GoogleTokensError } from "@calendar/auth/google-tokens";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { GoogleCalendarClient } from "../src/google.js";
import { GoogleRetryPolicy, googleRequest } from "../src/transport.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const request = {
  accountId: "account",
  method: "GET",
  path: "/colors",
} as const;

describe("Google transport lifecycle", () => {
  it.effect.prop(
    "auth failures keep their domain meaning without issuing HTTP",
    {
      reason: Arbitrary.schema(
        Schema.Literals(["unavailable", "disconnected", "provider", "storage"])
      ),
    },
    ({ reason }) =>
      Effect.gen(function* authBoundary() {
        const fake = yield* fakeGoogle([]);

        const tokens = Layer.succeed(GoogleTokens, {
          accessToken: () =>
            Effect.fail(
              new GoogleTokensError({ accountId: "account", reason })
            ),
          accounts: () =>
            Effect.fail(
              new GoogleTokensError({ accountId: "account", reason })
            ),
        });

        const failure = yield* googleRequest(request).pipe(
          Effect.flip,
          Effect.provide(Layer.merge(fake.layer, tokens)),
          Effect.provideService(GoogleRetryPolicy, {
            baseDelayMs: 0,
            retries: 0,
          })
        );

        expect(failure._tag).toBe(
          {
            disconnected: "Revoked",
            provider: "Provider",
            storage: "Provider",
            unavailable: "NotConnected",
          }[reason]
        );
        expect(yield* Ref.get(fake.requests)).toEqual([]);
      })
  );
  it.effect.prop(
    "401 forces exactly one token refresh and a second 401 is Revoked",
    { denied: Arbitrary.schema(Schema.Boolean) },
    ({ denied }) =>
      Effect.gen(function* scenario0() {
        const fake = yield* fakeGoogle([
          response(401),
          response(denied ? 401 : 200),
        ]);

        const result = yield* googleRequest(request).pipe(
          Effect.result,
          Effect.provide(fake.layer)
        );

        expect(result._tag).toBe(denied ? "Failure" : "Success");
        expect(yield* Ref.get(fake.refreshes)).toEqual([false, true]);
        expect(yield* Ref.get(fake.requests)).toHaveLength(2);
      })
  );

  it.effect.prop(
    "429 and 5xx retries wait for provider delay then succeed",
    { status: Arbitrary.schema(Schema.Literals([429, 500, 503])) },
    ({ status }) =>
      Effect.gen(function* scenario1() {
        const fake = yield* fakeGoogle([
          response(status, {}, 2000),
          response(200),
        ]);

        const fiber = yield* googleRequest(request).pipe(
          Effect.provide(fake.layer),
          Effect.forkChild
        );

        yield* TestClock.adjust(1999);
        expect(yield* Ref.get(fake.requests)).toHaveLength(1);
        yield* TestClock.adjust(1);
        expect((yield* Fiber.join(fiber)).status).toBe(200);
        expect(yield* Ref.get(fake.requests)).toHaveLength(2);
      })
  );

  it.effect("429 retry budget ends with a typed RateLimited error", () =>
    Effect.gen(function* scenario2() {
      const fake = yield* fakeGoogle([
        response(429),
        response(429),
        response(429),
        response(429),
      ]);

      const fiber = yield* googleRequest(request).pipe(
        Effect.flip,
        Effect.provide(fake.layer),
        Effect.forkChild
      );

      yield* TestClock.adjust(7000);
      const error = yield* Fiber.join(fiber);
      expect(error._tag).toBe("RateLimited");
      expect(yield* Ref.get(fake.requests)).toHaveLength(4);
    })
  );

  it.effect(
    "watch and stopWatch preserve channel identities without exposing tokens",
    () =>
      Effect.gen(function* scenario3() {
        const fake = yield* fakeGoogle([
          response(200, {
            expiration: "123",
            id: "channel",
            resourceId: "resource",
          }),
          response(204),
        ]);

        yield* Effect.gen(function* scenario4() {
          const google = yield* GoogleCalendarClient;

          const channel = yield* google.watch(
            ref,
            "channel",
            "https://example.test/push",
            "opaque-channel-token"
          );

          expect(channel.resourceId).toBe("resource");
          yield* google.stopWatch(
            ref.accountId,
            channel.id,
            channel.resourceId
          );
          const requests = yield* Ref.get(fake.requests);
          expect(requests[0]?.path).toContain("/events/watch");
          expect(requests[1]?.path).toBe("/channels/stop");
          expect(requests[1]?.body).toBe(
            JSON.stringify({ id: "channel", resourceId: "resource" })
          );
        }).pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          )
        );
      })
  );

  it.effect(
    "moves and resizes pass complete offset times and opt-in sendUpdates",
    () =>
      Effect.gen(function* scenario5() {
        const fake = yield* fakeGoogle([response(200, timedEvent("event"))]);
        yield* Effect.gen(function* scenario6() {
          const google = yield* GoogleCalendarClient;
          yield* google.patch(
            { ...ref, eventId: "event" },
            {
              end: {
                dateTime: "2026-11-01T01:30:00-08:00",
                timeZone: "America/Los_Angeles",
              },
              start: {
                dateTime: "2026-11-01T01:30:00-07:00",
                timeZone: "America/Los_Angeles",
              },
            },
            { sendUpdates: "all" }
          );
          const requests = yield* Ref.get(fake.requests);
          expect(requests[0]?.path).toContain("sendUpdates=all");
          expect(requests[0]?.body).toContain("2026-11-01T01:30:00-08:00");
        }).pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          )
        );
      })
  );
});
