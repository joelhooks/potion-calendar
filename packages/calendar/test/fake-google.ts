import { Crypto, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import { ConferencingDefaults } from "../src/conferencing-defaults.js";
import type { ConferencingDefault } from "../src/conferencing-model.js";
import { GoogleTokens } from "../src/google-tokens.js";
import type { GoogleAccountValue } from "../src/google-tokens.js";
import { GoogleHttp } from "../src/transport.js";
import type { GoogleRequestValue, GoogleResponse } from "../src/transport.js";

export const fakeGoogleCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    digest: () =>
      Effect.die(new Error("Unexpected digest in Calendar Google fake")),
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
  })
);

export const fakeConferencingDefaults = Layer.succeed(ConferencingDefaults, {
  forAccount: () => Effect.succeed("unset"),
});

export const response = (
  status: number,
  body: Schema.Json = {},
  retryAfterMs = 0
): GoogleResponse => ({ body: JSON.stringify(body), retryAfterMs, status });

export const fakeGoogle = Effect.fn("fakeGoogle")(function* fakeGoogle(
  initial: readonly GoogleResponse[] = [],
  accounts: readonly GoogleAccountValue[] = [
    { disconnected: false, email: "owner@example.test", id: "account" },
  ],
  conferencingDefault: typeof ConferencingDefault.Type = "unset"
) {
  const pending = yield* Ref.make(initial);
  const crashAt = yield* Ref.make(Option.none<number>());
  const requests = yield* Ref.make<readonly GoogleRequestValue[]>([]);
  const refreshes = yield* Ref.make<readonly boolean[]>([]);

  const http = Layer.succeed(GoogleHttp, {
    execute: Effect.fn("fakeGoogle.execute")(function* execute(
      request: GoogleRequestValue,
      bearer: string
    ) {
      if (bearer !== "fake-token") {
        return yield* Effect.die(new Error("Unexpected fake bearer"));
      }

      yield* Ref.update(requests, (previous) => [...previous, request]);
      const index = (yield* Ref.get(requests)).length;

      if (index === Option.getOrElse(yield* Ref.get(crashAt), () => -1)) {
        return yield* Effect.die(
          new Error("Simulated worker crash before provider accepted request")
        );
      }

      const next = yield* Ref.modify(pending, (queue) => [
        queue[0],
        queue.slice(1),
      ]);

      if (next === undefined) {
        return yield* Effect.die(
          new Error(
            `Unexpected Google request: ${request.method} ${request.path}`
          )
        );
      }

      return next;
    }),
  });

  const tokens = Layer.succeed(GoogleTokens, {
    accessToken: (_accountId, options) =>
      Ref.update(refreshes, (previous) => [
        ...previous,
        options?.forceRefresh === true,
      ]).pipe(Effect.as(Redacted.make("fake-token"))),
    accounts: () => Effect.succeed(accounts),
  });

  return {
    crashAt,
    layer: Layer.mergeAll(
      http,
      tokens,
      fakeGoogleCrypto,
      Layer.succeed(ConferencingDefaults, {
        forAccount: () => Effect.succeed(conferencingDefault),
      })
    ),
    pending,
    refreshes,
    requests,
  };
});

export const ref = { accountId: "account", calendarId: "calendar" };

export const timedEvent = (
  id: string,
  title = "Meeting",
  extra: Schema.Json = {}
) => {
  const fields = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Json)
  )(extra);

  const recurringEventId = Schema.decodeUnknownSync(
    Schema.optional(Schema.String)
  )(fields.recurringEventId);

  return {
    end: {
      dateTime: "2026-03-15T10:00:00-07:00",
      timeZone: "America/Los_Angeles",
    },
    iCalUID: `${recurringEventId ?? id}@fake.test`,
    id,
    organizer: { self: true },
    start: {
      dateTime: "2026-03-15T09:00:00-07:00",
      timeZone: "America/Los_Angeles",
    },
    status: "confirmed",
    summary: title,
    ...fields,
  };
};
