import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { rpcValue } from "./calendar-rpc.js";
import { nativeWorkerFixture } from "./native-worker-fixture.js";

it.effect(
  "the real Worker serves only recognized GET/HEAD document routes and keeps RPC separate",
  () =>
    Effect.gen(function* documentRoutes() {
      const { miniflare } = yield* nativeWorkerFixture();
      const origin = "https://calendar.wzrrd.sh";

      for (const path of [
        "/",
        "/search?q=alpha",
        "/settings",
        "/settings/general",
        "/settings/calendars",
        "/settings/calendar/account%2Fwith%3Fescapes",
        "/shortcuts#calendar-view",
      ]) {
        for (const method of ["GET", "HEAD"]) {
          const response = yield* Effect.promise(
            miniflare.dispatchFetch.bind(miniflare, `${origin}${path}`, {
              method,
            })
          );

          expect(response.status).toBe(200);
          expect(yield* Effect.promise(response.text.bind(response))).toBe(
            method === "HEAD" ? "" : "fixture"
          );
          expect(response.headers.get("x-content-generation")).toBe(
            "fixture-release"
          );
        }
      }

      for (const path of [
        "/release.json",
        "/.env",
        "/admin",
        "/settings/typo",
        "/settings/calendar/%FF",
      ]) {
        const response = yield* Effect.promise(
          miniflare.dispatchFetch.bind(miniflare, `${origin}${path}`, {})
        );

        expect(response.status).toBe(404);
      }

      for (const path of ["/", "/search", "/settings/general", "/shortcuts"]) {
        const response = yield* Effect.promise(
          miniflare.dispatchFetch.bind(miniflare, `${origin}${path}`, {
            method: "POST",
          })
        );

        expect(response.status).toBe(404);
      }

      const rpc = yield* Effect.promise(
        miniflare.dispatchFetch.bind(miniflare, `${origin}/rpc`, {
          body: '{"_tag":"Request","headers":[],"id":"1","tag":"session","payload":{}}',
          headers: { "content-type": "application/json", origin },
          method: "POST",
        })
      );

      expect(rpc.status).toBe(200);
      const document: unknown = yield* Effect.promise(rpc.json.bind(rpc));
      expect(
        (yield* Schema.decodeUnknownEffect(rpcValue(SessionSnapshot))(
          document
        ))[0].exit.value
      ).toBeNull();
    })
);
