import {
  GoogleCalendarClient,
  GoogleTokens,
  NotConnected,
  Provider,
} from "@calendar/calendar";
import type {
  GooglePushRepository,
  PushChannelValue,
} from "@calendar/database/google-push";
import { Effect } from "effect";

const unavailable = () =>
  new Provider({
    message: "Google channel cleanup is unavailable",
    operation: "watch.stop",
    status: 0,
  });

export const stopGoogleChannel = Effect.fn("stopGoogleChannel")(
  function* stopGoogleChannel(
    repository: GooglePushRepository,
    personId: string,
    channel: PushChannelValue,
    connected: boolean
  ) {
    if (!connected || channel.resourceId === null) {
      yield* repository
        .finish(personId, channel.id, "orphaned")
        .pipe(Effect.mapError(unavailable));

      return;
    }

    const google = yield* GoogleCalendarClient;
    yield* repository
      .beginStop(personId, channel.id)
      .pipe(Effect.mapError(unavailable));
    yield* google
      .stopWatch(channel.accountId, channel.id, channel.resourceId)
      .pipe(
        Effect.andThen(
          repository
            .finish(personId, channel.id, "stopped")
            .pipe(Effect.mapError(unavailable))
        ),
        Effect.catchTag(["Revoked", "NotConnected"], () =>
          repository
            .finish(personId, channel.id, "orphaned")
            .pipe(Effect.mapError(unavailable))
        )
      );
  }
);

export const stopAccountGoogleChannels = Effect.fn("stopAccountGoogleChannels")(
  function* stopAccountGoogleChannels(
    repository: GooglePushRepository,
    personId: string,
    accountId: string
  ) {
    const tokens = yield* GoogleTokens;

    const accounts = yield* tokens
      .accounts()
      .pipe(Effect.mapError(unavailable));

    const account = accounts.find((candidate) => candidate.id === accountId);

    if (account === undefined) {
      return yield* new NotConnected({ accountId });
    }

    const listPage = (after?: string) =>
      (after === undefined
        ? repository.list(personId, { limit: 100 })
        : repository.list(personId, { after, limit: 100 })
      ).pipe(Effect.mapError(unavailable));

    let after: string | undefined;

    while (true) {
      const page = yield* listPage(after);

      for (const channel of page) {
        if (channel.accountId === accountId) {
          yield* stopGoogleChannel(
            repository,
            personId,
            channel,
            !account.disconnected
          );
        }
      }

      const last = page.at(-1);

      if (last === undefined || page.length < 100) {
        break;
      }

      after = last.id;
    }

    return yield* Effect.void;
  }
);
