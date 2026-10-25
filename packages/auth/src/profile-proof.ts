import { Cause, Effect, Schema } from "effect";

const ProofHex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));

const unavailable = (cause: unknown) =>
  new Cause.UnknownError(cause, "Profile confirmation is unavailable");

const profileKey = (secret: string) =>
  Effect.tryPromise({
    catch: unavailable,
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

const profileMessage = (sessionToken: string) =>
  new TextEncoder().encode(`calendar.profile-update:1:${sessionToken}`);

export const profileUpdateProof = Effect.fn("profileUpdateProof")(
  function* profileUpdateProof(secret: string, sessionToken: string) {
    const key = yield* profileKey(secret);

    const signature = yield* Effect.tryPromise({
      catch: unavailable,
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => crypto.subtle.sign("HMAC", key, profileMessage(sessionToken)),
    });

    return [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
);

export const verifyProfileUpdateProof = Effect.fn("verifyProfileUpdateProof")(
  function* verifyProfileUpdateProof(
    secret: string,
    sessionToken: string,
    proof: string
  ) {
    if (!Schema.is(ProofHex)(proof)) {
      return false;
    }

    const key = yield* profileKey(secret);

    const bytes = Uint8Array.from({ length: 32 }, (_, index) =>
      Number.parseInt(proof.slice(index * 2, index * 2 + 2), 16)
    );

    return yield* Effect.tryPromise({
      catch: unavailable,
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        crypto.subtle.verify("HMAC", key, bytes, profileMessage(sessionToken)),
    });
  }
);
