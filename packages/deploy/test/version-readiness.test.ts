import { gateOutcome } from "@calendar/check-harness";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { contentVersionCheck, htmlContentVersionCheck } from "../src/checks.js";

it.effect.prop(
  "content identity accepts weak and strong ETags, but never a missing, stale or failed response",
  {
    matches: Schema.Boolean,
    missing: Schema.Boolean,
    ok: Schema.Boolean,
    weak: Schema.Boolean,
  },
  ({ matches, missing, ok, weak }) =>
    Effect.gen(function* test() {
      const etag = `${weak ? "W/" : ""}"${matches ? "expected-generation" : "old-generation"}:default:%2Findex.md"`;

      const client = HttpClient.make((request) => {
        expect(request.headers["accept-encoding"]).toBe("identity");
        expect(new URL(request.url).searchParams.get("__rat_version")).toBe(
          "expected-generation"
        );

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("content", {
              headers: missing ? {} : { etag },
              status: ok ? 200 : 503,
            })
          )
        );
      });

      const result = yield* contentVersionCheck(
        "https://example.test",
        "/index.md",
        "expected-generation"
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(gateOutcome(result) === "pass").toBe(ok && matches && !missing);
      expect(result.provenance?.[0]?.status).toBe(
        `http=${ok ? 200 : 503};etag=${missing ? "missing" : etag}`
      );

      if (missing) {
        expect(result.control).toBe(0);
        expect(result.status).toBe("hold");
      }
    }),
  { arbitrary: { runs: 100 } }
);

it.effect.prop(
  "served HTML must carry the current generation; a stale, missing or failed page never passes",
  {
    matches: Schema.Boolean,
    missing: Schema.Boolean,
    ok: Schema.Boolean,
  },
  ({ matches, missing, ok }) =>
    Effect.gen(function* test() {
      const client = HttpClient.make((request) => {
        expect(request.headers.accept).toBe("text/html");

        const generation = matches ? "expected-generation" : "old-generation";

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("<html></html>", {
              headers: missing ? {} : { "x-content-generation": generation },
              status: ok ? 200 : 503,
            })
          )
        );
      });

      const result = yield* htmlContentVersionCheck(
        "https://example.test",
        "/news",
        "expected-generation"
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(gateOutcome(result) === "pass").toBe(ok && matches && !missing);

      if (missing) {
        expect(result.status).toBe("hold");
      } else if (!matches) {
        expect(result.reason).toBe("content-version-mismatch");
      }
    }),
  { arbitrary: { runs: 100 } }
);
