import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { reminderWorkerSource } from "../sw-notification-source.js";
import { nativeWorkerFixture } from "./native-worker-fixture.js";

it.effect(
  "the production Worker serves the exact root notification script as uncached JavaScript without widening other asset paths",
  () =>
    Effect.gen(function* workerAsset() {
      const expected = yield* reminderWorkerSource;

      const { miniflare } = yield* nativeWorkerFixture(
        undefined,
        undefined,
        expected
      );

      const origin = "https://calendar.wzrrd.sh";

      for (const method of ["GET", "HEAD"]) {
        const response = yield* Effect.promise(
          miniflare.dispatchFetch.bind(
            miniflare,
            `${origin}/reminder-worker.js`,
            { method }
          )
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(
          "application/javascript; charset=utf-8"
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("x-content-generation")).toBe(
          "fixture-release"
        );
        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(response.headers.get("service-worker-allowed")).toBeNull();
        expect(yield* Effect.promise(response.text.bind(response))).toBe(
          method === "HEAD" ? "" : expected
        );
      }

      const refused: readonly (readonly [string, string])[] = [
        ["/reminder-worker.js", "POST"],
        ["/reminder-worker-typo.js", "GET"],
        ["/release.json", "GET"],
      ];

      for (const [path, method] of refused) {
        const response = yield* Effect.promise(
          miniflare.dispatchFetch.bind(miniflare, `${origin}${path}`, {
            method,
          })
        );

        expect(response.status).toBe(404);
      }
    })
);
