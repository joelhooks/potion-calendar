import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { DeleteAccountInput } from "../src/contracts.js";

const proof = "a".repeat(64);

it.effect(
  "deletion accepts only the explicit current-session confirmation",
  () =>
    Effect.gen(function* confirmedDeletionInput() {
      const confirmed = yield* Schema.decodeEffect(DeleteAccountInput)({
        confirmation: "permanently-delete-my-account",
        proof,
      });

      expect(confirmed).toEqual({
        confirmation: "permanently-delete-my-account",
        proof,
      });
      expect(
        yield* Schema.encodeEffect(Schema.toCodecJson(DeleteAccountInput))(
          confirmed
        )
      ).toEqual(confirmed);

      for (const key of [
        "id",
        "userId",
        "personId",
        "ownerId",
        "accountId",
        "confirmation\n",
        "__proto__",
      ]) {
        const result = yield* Schema.decodeEffect(DeleteAccountInput)({
          confirmation: "permanently-delete-my-account",
          proof,
          [key]: "person-b",
        }).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
      }

      for (const input of [
        {},
        { confirmation: false, proof },
        { confirmation: true, proof },
        { confirmation: "permanently-delete-my-account" },
        { confirmation: "permanently-delete-my-account", proof: "invalid" },
      ]) {
        const result = yield* Schema.decodeUnknownEffect(DeleteAccountInput)(
          input
        ).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
      }
    })
);

it.effect.prop(
  "no caller-selected field can supplement or replace the deletion confirmation",
  { key: Schema.String },
  ({ key }) =>
    Effect.gen(function* refusedSelectedOwner() {
      const result = yield* Schema.decodeEffect(DeleteAccountInput)({
        confirmation: "permanently-delete-my-account",
        proof,
        [key]: "person-b",
      }).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
    })
);
