import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";

import { calendarOrigin } from "../../src/server/calendar-origin.js";
import { nativeWorkerFixture } from "./native-worker-fixture.js";

it.effect(
  "production accepts only canonical HTTPS origins and the explicit dev policy accepts loopback",
  () =>
    Effect.gen(function* originPolicy() {
      expect(
        yield* calendarOrigin("https://calendar.wzrrd.sh", "production")
      ).toBe("https://calendar.wzrrd.sh");

      for (const invalid of [
        "http://localhost:5173",
        "https://calendar.wzrrd.sh/path",
        "https://calendar.wzrrd.sh?x=1",
        "https://user:pass@calendar.wzrrd.sh",
        "not-an-origin",
      ]) {
        expect(
          (yield* calendarOrigin(invalid, "production").pipe(Effect.flip))
            .operation
        ).toBe("startup");
      }

      expect(
        yield* calendarOrigin("http://localhost:5173", "development")
      ).toBe("http://localhost:5173");
      expect(
        yield* calendarOrigin("https://calendar.localhost:1355", "development")
      ).toBe("https://calendar.localhost:1355");
      expect(
        (yield* calendarOrigin("http://remote.example", "development").pipe(
          Effect.flip
        )).operation
      ).toBe("startup");
    })
);

it.effect(
  "the real Worker refuses a mismatched origin before serving its release generation",
  () =>
    Effect.gen(function* releaseOrigin() {
      const { miniflare } = yield* nativeWorkerFixture();

      const healthy = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => miniflare.dispatchFetch("https://calendar.wzrrd.sh/"),
      }).pipe(Effect.orDie);

      const mismatch = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => miniflare.dispatchFetch("https://wrong.example/"),
      }).pipe(Effect.orDie);

      const anonymous = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          miniflare.dispatchFetch("https://calendar.wzrrd.sh/live", {
            headers: {
              origin: "https://calendar.wzrrd.sh",
              upgrade: "websocket",
            },
          }),
      }).pipe(Effect.orDie);

      expect(healthy.status).toBe(200);
      expect(healthy.headers.get("x-content-generation")).toBe(
        "fixture-release"
      );
      expect(mismatch.status).toBe(503);
      expect(anonymous.status).toBe(401);
    })
);
