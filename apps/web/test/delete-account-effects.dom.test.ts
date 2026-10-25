import {
  AccountDeletionRefused,
  DeleteAccountInput,
} from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { AccountDeletionPort } from "../src/client/settings/delete-account/port.js";

const Envelope = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Int]),
  payload: DeleteAccountInput,
  tag: Schema.Literal("deleteAccount"),
});

const Success = Schema.TaggedStruct("Success", { value: Schema.Json });

const Fail = Schema.TaggedStruct("Fail", { error: AccountDeletionRefused });

const Failure = Schema.TaggedStruct("Failure", { cause: Schema.Array(Fail) });

const ResponseExit = Schema.TaggedStruct("Exit", {
  exit: Schema.Union([Success, Failure]),
  requestId: Schema.Union([Schema.String, Schema.Int]),
});

const suppliedDeletionFetch = (
  requests: Request[],
  status: number,
  acknowledged: boolean
) => {
  // @effect-diagnostics-next-line asyncFunction:off -- This native fetch reads the real RPC request and returns a local protocol reply without network traffic.
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
              ? Success.make({ value: acknowledged ? { deleted: true } : {} })
              : Failure.make({
                  cause: [Fail.make({ error: new AccountDeletionRefused() })],
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
  "the actual browser port sends one proof-only confirmation RPC and never follows it with browser sign-out",
  () =>
    Effect.gen(function* browserDeletionWire() {
      const requests: Request[] = [];
      const port = yield* AccountDeletionPort;
      yield* port
        .remove("a".repeat(64))
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedDeletionFetch(requests, 200, true)
          )
        );
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request?.method).toBe("POST");
      expect(
        new URL(request?.url ?? "https://calendar.test/missing").pathname
      ).toBe("/rpc/");

      if (request === undefined) {
        return yield* Effect.die(
          new Error("Deletion did not send its RPC request")
        );
      }

      const body: unknown = yield* Effect.promise(request.json.bind(request));

      const frames = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(Envelope)
      )(Array.isArray(body) ? body : [body]);

      expect(frames).toHaveLength(1);
      expect(frames[0].payload).toEqual({
        confirmation: "permanently-delete-my-account",
        proof: "a".repeat(64),
      });
      expect(Object.keys(frames[0].payload).toSorted()).toEqual([
        "confirmation",
        "proof",
      ]);

      return yield* Effect.void;
    })
);

it.effect.each([409, 503, 200])(
  "HTTP %s without a valid deletion acknowledgment stays a typed failure",
  (status) =>
    Effect.gen(function* refusedBrowserDeletion() {
      const requests: Request[] = [];
      const port = yield* AccountDeletionPort;

      const result = yield* port
        .remove("a".repeat(64))
        .pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            suppliedDeletionFetch(requests, status, false)
          ),
          Effect.result
        );

      expect(requests).toHaveLength(1);
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("AccountDeletionUnavailable");
      }
    })
);
