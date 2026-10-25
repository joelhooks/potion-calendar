import {
  ProfileUpdateRefused,
  SaveProfileInput,
} from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Result, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { afterEach, vi } from "vitest";

import { ProfilePort } from "../src/client/settings/profile/port.js";
import { profileUnloadStream } from "../src/client/settings/profile/subscription.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const Envelope = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Int]),
  payload: SaveProfileInput,
  tag: Schema.Literal("saveProfile"),
});

const Success = Schema.TaggedStruct("Success", { value: Schema.Json });

const Fail = Schema.TaggedStruct("Fail", { error: ProfileUpdateRefused });

const Failure = Schema.TaggedStruct("Failure", { cause: Schema.Array(Fail) });

const ResponseExit = Schema.TaggedStruct("Exit", {
  exit: Schema.Union([Success, Failure]),
  requestId: Schema.Union([Schema.String, Schema.Int]),
});

const suppliedFetch = (
  requests: Request[],
  status: number,
  acknowledged: boolean
) => {
  // @effect-diagnostics-next-line asyncFunction:off -- The supplied native fetch reads the actual request body but sends no network traffic.
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "https://calendar.test"), init);

    requests.push(request.clone());
    const raw: unknown = await request.json();

    const frames = Schema.decodeUnknownSync(Schema.NonEmptyArray(Envelope))(
      Array.isArray(raw) ? raw : [raw]
    );

    return Response.json(
      frames.map((frame) =>
        ResponseExit.make({
          exit:
            status === 200
              ? Success.make({
                  value: acknowledged
                    ? {
                        name: frame.payload.name,
                        primaryAccountId:
                          frame.payload.primaryAccountId ?? null,
                      }
                    : {},
                })
              : Failure.make({
                  cause: [Fail.make({ error: new ProfileUpdateRefused() })],
                }),
          requestId: frame.id,
        })
      ),
      { status }
    );
  };

  return fetcher;
};

it.effect(
  "the browser profile writer sends exactly one atomic name and primary-account RPC without a caller-supplied person",
  () =>
    Effect.gen(function* profileHttpRecipient() {
      const requests: Request[] = [];
      const port = yield* ProfilePort;

      const saved = yield* port
        .save("Saved Person", {
          primaryAccountId: "account-b",
          proof: "a".repeat(64),
        })
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedFetch(requests, 200, true)
          )
        );

      expect(saved).toEqual({
        name: "Saved Person",
        primaryAccountId: "account-b",
      });
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request?.method).toBe("POST");
      expect(
        new URL(request?.url ?? "https://calendar.test/missing").pathname
      ).toBe("/rpc/");
      expect(request?.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(request).toBeDefined();

      if (request !== undefined) {
        const raw: unknown = yield* Effect.promise(request.json.bind(request));

        const body = yield* Schema.decodeUnknownEffect(
          Schema.NonEmptyArray(Envelope)
        )(Array.isArray(raw) ? raw : [raw]);

        expect(body[0].payload).toEqual({
          name: "Saved Person",
          primaryAccountId: "account-b",
          proof: "a".repeat(64),
        });
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
        .save("Saved Person", { proof: "a".repeat(64) })
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedFetch(requests, status, false)
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
