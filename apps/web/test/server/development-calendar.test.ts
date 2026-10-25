import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { makeDevelopmentBackend } from "../../src/dev/backend.js";
import { rpcDocument, rpcValue } from "./calendar-rpc.js";

it.effect(
  "development signs in a fixture person with two connected accounts",
  () =>
    Effect.gen(function* developmentPerson() {
      const backend = makeDevelopmentBackend("http://calendar.test");

      const request = new Request("http://calendar.test/rpc", {
        body: '{"_tag":"Request","headers":[],"id":"1","payload":{},"tag":"session"}',
        headers: {
          "content-type": "application/json",
          origin: "http://calendar.test",
        },
        method: "POST",
      });

      const response = yield* Effect.promise(backend.bind(undefined, request));
      const body: unknown = yield* Effect.promise(response.json.bind(response));

      const frames = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(
          Schema.Struct({ exit: Schema.Struct({ _tag: Schema.String }) })
        )
      )(body);

      expect(frames[0].exit._tag).toBe("Success");

      const replies = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            exit: Schema.Struct({
              value: Schema.Struct({
                accounts: Schema.Array(
                  Schema.Struct({
                    disconnected: Schema.Boolean,
                    email: Schema.String,
                    id: Schema.String,
                  })
                ),
                user: Schema.Struct({ id: Schema.String }),
              }),
            }),
          })
        )
      )(body);

      expect(
        replies[0]?.exit.value.accounts.map((account) => account.email)
      ).toEqual(["joel@example.test", "second@example.test"]);
      expect(
        replies[0]?.exit.value.accounts.every(
          (account) => !account.disconnected
        )
      ).toBe(true);

      const cookie = response.headers
        .getSetCookie()
        .map((entry) => entry.split(";")[0] ?? "")
        .join("; ");

      expect(cookie).not.toBe("");

      const signedOut = yield* Effect.promise(
        backend.bind(
          undefined,
          new Request("http://calendar.test/auth/sign-out", {
            body: "{}",
            headers: {
              "content-type": "application/json",
              cookie,
              origin: "http://calendar.test",
            },
            method: "POST",
          })
        )
      );

      expect(signedOut.status).toBe(200);
      const anonymous = yield* rpcDocument(backend, "session");

      const afterSignOut = yield* Schema.decodeUnknownEffect(
        rpcValue(SessionSnapshot)
      )(anonymous);

      expect(afterSignOut[0].exit.value).toBeNull();
    })
);
