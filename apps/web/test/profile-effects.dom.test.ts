import { ProfileUpdateInput } from "@calendar/auth/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Result, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { afterEach, vi } from "vitest";

import { ProfilePort } from "../src/client/settings/profile/port.js";
import { profileUnloadStream } from "../src/client/settings/profile/subscription.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const suppliedFetch = (
  requests: Request[],
  status: number,
  body: Readonly<Record<string, boolean>>
) => {
  // @effect-diagnostics-next-line asyncFunction:off -- The supplied native fetch reads the actual request body but sends no network traffic.
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "https://calendar.test"), init);

    requests.push(request);
    await request.clone().text();

    return Response.json(body, { status });
  };

  return fetcher;
};

it.effect(
  "the native profile writer sends exactly one name-only POST to the existing auth endpoint",
  () =>
    Effect.gen(function* profileHttpRecipient() {
      const requests: Request[] = [];
      const port = yield* ProfilePort;

      const saved = yield* port
        .save("Saved Person")
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedFetch(requests, 200, { status: true })
          )
        );

      expect(saved).toBe("Saved Person");
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request?.method).toBe("POST");
      expect(
        new URL(request?.url ?? "https://calendar.test/missing").pathname
      ).toBe("/auth/update-user");
      expect(request?.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(request).toBeDefined();

      if (request !== undefined) {
        const body = yield* Effect.promise(request.json.bind(request)).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(ProfileUpdateInput, {
              onExcessProperty: "error",
            })
          )
        );

        expect(body).toEqual({ name: "Saved Person" });
      }
    })
);

it.effect.each([503, 200])(
  "HTTP response %s without a valid save acknowledgment remains a typed failure",
  (status) =>
    Effect.gen(function* failedProfileHttp() {
      const requests: Request[] = [];
      const port = yield* ProfilePort;

      const result = yield* port
        .save("Saved Person")
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedFetch(requests, status, {})
          ),
          Effect.result
        );

      expect(requests).toHaveLength(1);
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("ProfileFailure");
      }
    })
);

it.effect(
  "the dirty unload listener is gone when its actual stream owner is interrupted",
  () =>
    Effect.gen(function* profileUnloadScope() {
      const entered = yield* Queue.unbounded<true>();
      const original = window.addEventListener.bind(window);
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type, listener, options) => {
          original(type, listener, options);

          if (type === "beforeunload") {
            Queue.offerUnsafe(entered, true);
          }
        }
      );

      const owner = yield* profileUnloadStream(true).pipe(
        Stream.runDrain,
        Effect.forkScoped
      );

      yield* Queue.take(entered);
      const active = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(active);
      expect(active.defaultPrevented).toBe(true);
      yield* Fiber.interrupt(owner);
      const released = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(released);
      expect(released.defaultPrevented).toBe(false);
    })
);
