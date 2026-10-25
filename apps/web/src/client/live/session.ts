import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { clearReminderSnoozes } from "../reminders/snooze-storage.js";
import { clearPreferences } from "../settings/preference-storage.js";

const LiveSession = Schema.NullOr(
  Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
);

export const liveSessionExists = Effect.gen(function* liveSessionExists() {
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const response = yield* client.get("/auth/get-session");

  const session =
    yield* HttpClientResponse.schemaBodyJson(LiveSession)(response);

  return session !== null;
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.orElseSucceed(() => true)
);

export const clearEndedSessionStorage = Effect.fn("clearEndedSessionStorage")(
  function* clearEndedSessionStorage(personId: string) {
    yield* clearPreferences(personId).pipe(
      Effect.catchCause(() =>
        Effect.logWarning("Ended session preference cleanup did not complete")
      )
    );
    yield* clearReminderSnoozes(personId).pipe(
      Effect.catchCause(() =>
        Effect.logWarning("Ended session snooze cleanup did not complete")
      )
    );
  }
);
