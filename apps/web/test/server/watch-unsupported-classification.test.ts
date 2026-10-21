import {
  GoogleHttp,
  GoogleRetryPolicy,
  GoogleTokens,
  googleRequest,
} from "@calendar/calendar";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";

import { unsupportedEventWatch } from "../../src/server/google-watch-unsupported.js";

const refusal = (
  status: number,
  body: string,
  path = "/calendars/ordinary-resource/events/watch",
  method: "GET" | "POST" = "POST"
) =>
  googleRequest({ accountId: "account", method, path }).pipe(
    Effect.provide(
      Layer.merge(
        Layer.succeed(GoogleHttp, {
          execute: () => Effect.succeed({ body, retryAfterMs: 0, status }),
        }),
        Layer.succeed(GoogleTokens, {
          accessToken: () => Effect.succeed(Redacted.make("test-token")),
          accounts: () => Effect.succeed([]),
        })
      )
    ),
    Effect.provideService(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 }),
    Effect.flip
  );

const body = (reasons: readonly string[]) =>
  JSON.stringify({
    error: { errors: reasons.map((reason) => ({ reason })) },
  });

it.effect(
  "each documented recovery reason prevents permanence in either position, including anomalous 400 responses",
  () =>
    Effect.gen(function* exclusions() {
      for (const reason of [
        "authError",
        "userRateLimitExceeded",
        "rateLimitExceeded",
        "quotaExceeded",
        "forbiddenForNonOrganizer",
      ]) {
        for (const status of [400, 403, 404]) {
          for (const reasons of [
            [reason],
            ["syntheticRefusal", reason],
            [reason, "syntheticRefusal"],
          ]) {
            const error = yield* refusal(status, body(reasons));
            expect(unsupportedEventWatch(error)).toBe(false);
          }
        }
      }
    })
);

it.effect(
  "only structured 400/403 event-watch refusals become permanent, never id patterns, 404 or other transient statuses, other endpoints or malformed reasons",
  () =>
    Effect.gen(function* boundaries() {
      for (const status of [400, 403]) {
        expect(
          unsupportedEventWatch(yield* refusal(status, body(["notFound"])))
        ).toBe(true);
        expect(
          unsupportedEventWatch(
            yield* refusal(
              status,
              body(["notFound"]),
              "/calendars/example%23holiday/events/watch"
            )
          )
        ).toBe(true);

        for (const raw of [
          "not-json",
          "{}",
          body([]),
          body(["unsafe reason"]),
          body(["safeReason", "bad\nreason"]),
        ]) {
          expect(unsupportedEventWatch(yield* refusal(status, raw))).toBe(
            false
          );
        }
      }

      for (const status of [401, 404, 409, 410, 422, 429, 500, 503]) {
        expect(
          unsupportedEventWatch(yield* refusal(status, body(["notFound"])))
        ).toBe(false);
      }

      expect(
        unsupportedEventWatch(
          yield* refusal(
            403,
            body(["notFound"]),
            "/users/me/calendarList/watch"
          )
        )
      ).toBe(false);
      expect(
        unsupportedEventWatch(
          yield* refusal(
            404,
            body(["notFound"]),
            "/calendars/ordinary-resource",
            "GET"
          )
        )
      ).toBe(false);
    })
);
