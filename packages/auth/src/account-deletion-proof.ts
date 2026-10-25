import { Cause, Effect, Schema } from "effect";

const ProofHex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));

const deletionKey = (secret: string) =>
  Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(
        cause,
        "Account deletion confirmation is unavailable"
      ),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign", "verify"]
      ),
  });

const deletionMessage = (sessionToken: string) =>
  new TextEncoder().encode(`calendar.delete-account:1:${sessionToken}`);

export const accountDeletionProof = Effect.fn("accountDeletionProof")(
  function* accountDeletionProof(secret: string, sessionToken: string) {
    const key = yield* deletionKey(secret);

    const signature = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(
          cause,
          "Account deletion confirmation is unavailable"
        ),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => crypto.subtle.sign("HMAC", key, deletionMessage(sessionToken)),
    });

    return [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
);

export const verifyAccountDeletionProof = Effect.fn(
  "verifyAccountDeletionProof"
)(function* verifyAccountDeletionProof(
  secret: string,
  sessionToken: string,
  proof: string
) {
  if (!Schema.is(ProofHex)(proof)) {
    return false;
  }

  const key = yield* deletionKey(secret);

  const bytes = Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(proof.slice(index * 2, index * 2 + 2), 16)
  );

  return yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(
        cause,
        "Account deletion confirmation is unavailable"
      ),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () =>
      crypto.subtle.verify("HMAC", key, bytes, deletionMessage(sessionToken)),
  });
});
