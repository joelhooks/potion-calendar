import { expect, it } from "@effect/vitest";
import { Cause, Effect, Ref } from "effect";

import { tokenHash } from "../../src/server/google-channel-lifecycle.js";
import { receiveGooglePush } from "../../src/server/google-push-webhook.js";
import { pendingChannel, seededPushRepository } from "./google-push-fixture.js";

it.effect(
  "push rejects unknown, wrong-token, wrong-resource, expired and disconnected channels without a delivery; sync only acknowledges",
  () =>
    Effect.gen(function* webhookGuards() {
      const { database, repository } = yield* seededPushRepository;
      const token = "random-fixture-token";
      const hash = yield* tokenHash(token);
      const delivered = yield* Ref.make<readonly string[]>([]);
      yield* repository.insertPending({
        ...pendingChannel("known"),
        tokenHash: hash,
      });
      yield* repository.activate({
        expiresAt: 1000,
        id: "known",
        personId: "person-a",
        predecessorId: null,
        resourceId: "resource",
      });
      yield* repository.insertPending({
        ...pendingChannel("expired"),
        expiresAt: 0,
        tokenHash: hash,
      });
      yield* repository.insertPending({
        ...pendingChannel("racing"),
        tokenHash: hash,
      });

      const send = (
        id: string,
        supplied = token,
        state = "exists",
        resource = "resource",
        number = "2"
      ) =>
        receiveGooglePush(
          new Request("https://calendar.wzrrd.sh/google/push", {
            headers: {
              "x-goog-channel-id": id,
              "x-goog-channel-token": supplied,
              "x-goog-message-number": number,
              "x-goog-resource-id": resource,
              "x-goog-resource-state": state,
            },
            method: "POST",
          }),
          "person-a@example.test",
          repository,
          (channel, messageNumber) =>
            Ref.update(delivered, (values) => [
              ...values,
              `${channel.id}:${messageNumber}`,
            ])
        );

      for (const [id, supplied, resource] of [
        ["unknown", token, "resource"],
        ["known", "wrong", "resource"],
        ["known", token, "wrong"],
        ["expired", token, "resource"],
      ]) {
        const response = yield* send(id ?? "", supplied, "exists", resource);
        expect(response.status).toBe(404);
        expect(yield* Effect.promise(response.text.bind(response))).toBe("");
      }

      expect((yield* send("known", token, "sync")).status).toBe(200);
      expect((yield* send("racing", token, "sync")).status).toBe(200);
      expect(yield* Ref.get(delivered)).toEqual([]);
      const admitted = yield* send("known");
      const duplicate = yield* send("known");
      expect(admitted.status).toBe(200);
      expect(duplicate.status).toBe(admitted.status);
      expect(yield* Effect.promise(admitted.text.bind(admitted))).toBe("");
      expect(yield* Effect.promise(duplicate.text.bind(duplicate))).toBe("");
      expect(yield* Ref.get(delivered)).toEqual(["known:2", "known:2"]);
      expect(
        (yield* send("known", token, "exists", "resource", "not-a-number"))
          .status
      ).toBe(404);
      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          database
            .prepare(
              "UPDATE account SET disconnected = 1 WHERE id = 'person-a-google'"
            )
            .run(),
      }).pipe(Effect.orDie);
      expect((yield* send("known")).status).toBe(404);
      expect(yield* Ref.get(delivered)).toHaveLength(2);
    })
);
