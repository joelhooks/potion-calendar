import { GoogleCalendarClient } from "@calendar/calendar";
import type { Provider } from "@calendar/calendar";
import { AccountDeletionUnavailable } from "@calendar/core/contracts";
import {
  accountDeletionChannels,
  deleteCalendarAccount,
} from "@calendar/database";
import type { D1Database } from "@cloudflare/workers-types";
import { Effect } from "effect";

import { deleteOwnedCalendarAccount } from "./delete-account.js";

export interface AccountDeletionLiveControl {
  readonly finalize: Effect.Effect<void, Provider>;
  readonly pause: Effect.Effect<void, Provider>;
  readonly resume: Effect.Effect<void>;
}

export const stopAccountDeletionChannels = Effect.fn(
  "stopAccountDeletionChannels"
)(function* stopAccountDeletionChannels(
  database: D1Database,
  personId: string
) {
  const google = yield* GoogleCalendarClient;
  let after = "";

  while (true) {
    const page = yield* accountDeletionChannels(database, personId, after);

    for (const channel of page) {
      if (channel.resourceId !== null) {
        yield* google
          .stopWatch(channel.accountId, channel.id, channel.resourceId)
          .pipe(
            Effect.timeout("2 seconds"),
            Effect.catchCause(() =>
              Effect.logWarning(
                "Google channel stop did not complete during account deletion"
              )
            )
          );
      }
    }

    const last = page.at(-1);

    if (last === undefined || page.length < 100) {
      break;
    }

    after = last.id;
  }
});

const unavailable = () => new AccountDeletionUnavailable();

export const deleteAccountForPerson = Effect.fn("deleteAccountForPerson")(
  function* deleteAccountForPerson(
    database: D1Database,
    personId: string,
    live: AccountDeletionLiveControl
  ) {
    const google = yield* GoogleCalendarClient;

    return yield* deleteOwnedCalendarAccount({
      run: (step) => {
        switch (step) {
          case "quiesce": {
            return live.pause.pipe(Effect.mapError(unavailable));
          }

          case "stop": {
            return stopAccountDeletionChannels(database, personId).pipe(
              Effect.provideService(GoogleCalendarClient, google),
              Effect.mapError(unavailable)
            );
          }

          case "commit": {
            return deleteCalendarAccount(database, personId).pipe(
              Effect.mapError(unavailable)
            );
          }

          case "finalize": {
            return live.finalize.pipe(Effect.mapError(unavailable));
          }

          case "resume": {
            return live.resume;
          }

          default: {
            return Effect.die("Unknown account deletion step");
          }
        }
      },
    });
  }
);
