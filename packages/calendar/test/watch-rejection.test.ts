import { expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Redacted, Schema } from "effect";

import { GoogleTokens } from "../src/google-tokens.js";
import {
  GoogleHttp,
  GoogleRetryPolicy,
  googleRequest,
} from "../src/transport.js";

it.effect.prop(
  "watch rejection preserves only a safe Google reason code, without changing ordinary 404 classification",
  {
    reason: Schema.Literals([
      "pushNotSupportedForRequestedResource",
      "invalidResource",
      "private provider message with spaces",
      "secret\nvalue",
    ]),
    status: Schema.Literals([400, 404, 410, 422]),
    watch: Schema.Boolean,
  },
  ({ reason, status, watch }) =>
    Effect.gen(function* watchReason() {
      const http = Layer.succeed(GoogleHttp, {
        execute: () =>
          Effect.succeed({
            body: JSON.stringify({
              error: { errors: [{ reason }], message: "private-provider-body" },
            }),
            retryAfterMs: 0,
            status: watch ? status : 404,
          }),
      });

      const tokens = Layer.succeed(GoogleTokens, {
        accessToken: () => Effect.succeed(Redacted.make("secret-token")),
        accounts: () => Effect.succeed([]),
      });

      const failure = yield* googleRequest({
        accountId: "account",
        method: watch ? "POST" : "GET",
        path: watch
          ? "/calendars/ordinary/events/watch"
          : "/calendars/ordinary/events/missing",
      }).pipe(
        Effect.provide(Layer.merge(http, tokens)),
        Effect.provideService(GoogleRetryPolicy, {
          baseDelayMs: 0,
          retries: 0,
        }),
        Effect.flip
      );

      expect(failure._tag).toBe(watch ? "Provider" : "NotFound");

      if (Predicate.isTagged(failure, "Provider")) {
        expect(failure.operation).toBe("events.watch");
        expect(failure.status).toBe(status);
        expect(failure.reason).toBe(
          reason === "pushNotSupportedForRequestedResource" ||
            reason === "invalidResource"
            ? reason
            : undefined
        );
      }

      expect(JSON.stringify(failure)).not.toContain("private-provider-body");
      expect(JSON.stringify(failure)).not.toContain("secret-token");
    })
);
