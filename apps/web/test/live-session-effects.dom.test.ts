import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";

import { liveSessionExists } from "../src/client/live/session.js";

it.effect.each([
  { body: null, exists: false, status: 200 },
  { body: { user: { id: "b" } }, exists: true, status: 200 },
  { body: {}, exists: true, status: 200 },
  { body: null, exists: true, status: 503 },
])(
  "get-session status $status with $body has session=$exists without treating errors as sign-out",
  ({ body, status, exists }) =>
    Effect.gen(function* liveSessionHttpBoundary() {
      const requests: string[] = [];

      // oxlint-disable-next-line typescript/promise-function-async -- The native fetch adapter returns a deterministic local response without a network request.
      const fetcher: typeof globalThis.fetch = (input) => {
        requests.push(String(input instanceof Request ? input.url : input));

        return Promise.resolve(Response.json(body, { status }));
      };

      const actual = yield* liveSessionExists.pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      );

      expect(actual).toBe(exists);
      expect(requests).toHaveLength(1);
      expect(
        new URL(
          requests[0] ?? "https://calendar.test/missing",
          "https://calendar.test"
        ).pathname
      ).toBe("/auth/get-session");
    })
);
