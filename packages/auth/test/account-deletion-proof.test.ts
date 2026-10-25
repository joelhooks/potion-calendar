import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  accountDeletionProof,
  verifyAccountDeletionProof,
} from "../src/account-deletion-proof.js";

const secret = "local-account-deletion-test-secret-not-a-production-key";

it.effect.prop(
  "deletion confirmations verify only for their original session and secret",
  { token: Schema.String },
  ({ token }) =>
    Effect.gen(function* sessionBoundDeletionProof() {
      const first = `first:${token}`;
      const second = `other:${token}`;
      const proof = yield* accountDeletionProof(secret, first);
      expect(proof).toMatch(/^[a-f0-9]{64}$/u);
      expect(yield* verifyAccountDeletionProof(secret, first, proof)).toBe(
        true
      );
      expect(yield* verifyAccountDeletionProof(secret, second, proof)).toBe(
        false
      );
      expect(
        yield* verifyAccountDeletionProof(`${secret}-changed`, first, proof)
      ).toBe(false);
    })
);

it.effect.each(["", "invalid", "a".repeat(63), "a".repeat(65), "A".repeat(64)])(
  "malformed deletion confirmation is refused: %s",
  (proof) =>
    Effect.gen(function* malformedProof() {
      expect(yield* verifyAccountDeletionProof(secret, "first", proof)).toBe(
        false
      );
    })
);
