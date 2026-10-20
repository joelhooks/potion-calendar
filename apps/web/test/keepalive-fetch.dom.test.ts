import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { MutationTransportFailure } from "../src/client/editing/failure.js";
import { keepaliveFetch } from "../src/client/editing/keepalive-fetch.js";

const nativeCaller = (initiallyAborted: boolean) => {
  const controller = new AbortController();

  if (initiallyAborted) {
    controller.abort();
  }

  return {
    abort: () => {
      controller.abort();
    },
    request: new Request("https://fixture.invalid/rpc", {
      method: "POST",
      signal: controller.signal,
    }),
  };
};

it.effect.each([false, true])(
  "native keepalive detaches an inherited abort signal: %s",
  (initiallyAborted) =>
    Effect.gen(function* inheritedKeepaliveSignal() {
      const caller = yield* Effect.sync(() => nativeCaller(initiallyAborted));

      const received: Request[] = [];

      // @effect-diagnostics-next-line asyncFunction:off -- This fake implements the native Fetch Promise interface without making network requests.
      const fetcher: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        received.push(request);
        await request.arrayBuffer();

        return new Response(null, { status: 204 });
      };

      const reply = yield* Effect.tryPromise({
        catch: () =>
          new MutationTransportFailure({
            message: "Fixture native request refused",
          }),
        // @effect-diagnostics-next-line asyncFunction:off -- The keepalive adapter exposes the native Fetch Promise interface.
        try: async () =>
          await keepaliveFetch(fetcher)(caller.request, {
            credentials: "same-origin",
            headers: { "x-fixture": "preserved" },
          }),
      });

      yield* Effect.sync(caller.abort);
      expect(reply.status).toBe(204);
      expect(received).toHaveLength(1);
      expect(received[0]?.method).toBe("POST");
      expect(received[0]?.keepalive).toBe(true);
      expect(received[0]?.signal.aborted).toBe(false);
      expect(received[0]?.credentials).toBe("same-origin");
      expect(received[0]?.headers.get("x-fixture")).toBe("preserved");
    })
);
