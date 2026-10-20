import { GoogleTokens, Provider } from "@calendar/calendar";
import type { CalendarFailureValue } from "@calendar/calendar";
import type { ListCalendarsOutput } from "@calendar/calendar/contracts";
import type {
  GooglePushRepository,
  PushChannelValue,
  PushResourceValue,
} from "@calendar/database/google-push";
import { Clock, Effect, Predicate, Result } from "effect";

import {
  channelRenewalLeadMs,
  renewGoogleChannel,
} from "./google-channel-lifecycle.js";
import { stopGoogleChannel } from "./google-channel-stop.js";
import type { LiveMaintenanceState } from "./live-maintenance-state.js";
import { unwatchableWindowMs } from "./live-maintenance-state.js";

const resourceKey = (resource: PushResourceValue) =>
  JSON.stringify([resource.accountId, resource.kind, resource.calendarId]);

const unwantedChannel = (
  channel: PushChannelValue,
  disconnecting: ReadonlySet<string>,
  connected: ReadonlySet<string>,
  known: ReadonlySet<string>,
  desired: ReadonlySet<string>
) =>
  disconnecting.has(channel.accountId) ||
  !connected.has(channel.accountId) ||
  (known.has(channel.accountId) && !desired.has(resourceKey(channel)));

const unwatchable = (
  resource: PushResourceValue,
  error: CalendarFailureValue
): error is Provider =>
  resource.kind === "events" &&
  Predicate.isTagged(error, "Provider") &&
  error.operation === "events.watch" &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 403, 429].includes(error.status);

const storageFailure = () =>
  new Provider({
    message: "Google channel inventory is unavailable",
    operation: "watch",
    status: 0,
  });

const eventResourcesFor = (
  listing: typeof ListCalendarsOutput.Type,
  disconnecting: ReadonlySet<string>
) => {
  const resources: PushResourceValue[] = [];
  const failures: CalendarFailureValue[] = [];

  for (const account of listing.accounts) {
    if (disconnecting.has(account.accountId)) {
      continue;
    }

    if ("failure" in account) {
      failures.push(account.failure);
      continue;
    }

    for (const calendar of account.calendars) {
      resources.push({
        accountId: account.accountId,
        calendarId: calendar.calendarId,
        kind: "events",
      });
    }
  }

  return { failures, resources };
};

export const maintainGoogleChannels = Effect.fn("maintainGoogleChannels")(
  function* maintainGoogleChannels(
    repository: GooglePushRepository,
    personId: string,
    listing: typeof ListCalendarsOutput.Type,
    address: string,
    maintenance: Pick<LiveMaintenanceState, "blocked" | "suppress">,
    isDisconnecting: (
      accountId: string
    ) => Effect.Effect<boolean, Provider> = () => Effect.succeed(false)
  ) {
    const tokens = yield* GoogleTokens;

    const accounts = yield* tokens
      .accounts()
      .pipe(Effect.mapError(storageFailure));

    const disconnecting = new Set(
      (yield* Effect.forEach(
        accounts,
        (account) =>
          isDisconnecting(account.id).pipe(
            Effect.map((blocked) => (blocked ? account.id : undefined))
          ),
        { concurrency: 6 }
      )).filter(Predicate.isNotUndefined)
    );

    const connected = new Set(
      accounts
        .filter((account) => !account.disconnected)
        .map((account) => account.id)
    );

    const known = new Set(
      listing.accounts
        .filter((account) => "calendars" in account)
        .map((account) => account.accountId)
    );

    const listResources: PushResourceValue[] = accounts
      .filter(
        (account) => !account.disconnected && !disconnecting.has(account.id)
      )
      .map((account) => ({
        accountId: account.id,
        calendarId: null,
        kind: "calendarList",
      }));

    const { failures, resources: eventResources } = eventResourcesFor(
      listing,
      disconnecting
    );

    const resources = [...listResources, ...eventResources];

    const desired = new Set(resources.map(resourceKey));

    const stop = (channel: PushChannelValue) =>
      stopGoogleChannel(
        repository,
        personId,
        channel,
        connected.has(channel.accountId)
      );

    const listPage = (after?: string) =>
      (after === undefined
        ? repository.list(personId, { limit: 100 })
        : repository.list(personId, { after, limit: 100 })
      ).pipe(Effect.mapError(storageFailure));

    let after: string | undefined;

    while (true) {
      const page = yield* listPage(after);

      for (const channel of page) {
        const unwanted = unwantedChannel(
          channel,
          disconnecting,
          connected,
          known,
          desired
        );

        if (
          channel.state === "pending" ||
          channel.state === "stopping" ||
          unwanted
        ) {
          const outcome = yield* stop(channel).pipe(Effect.result);

          if (Result.isFailure(outcome)) {
            failures.push(outcome.failure);
          }
        }
      }

      const last = page.at(-1);

      if (last === undefined || page.length < 100) {
        break;
      }

      after = last.id;
    }

    const now = yield* Clock.currentTimeMillis;

    for (const resource of resources) {
      if (yield* maintenance.blocked(resource, now)) {
        continue;
      }

      const current = yield* repository
        .active(personId, resource)
        .pipe(Effect.mapError(storageFailure));

      if (
        current !== undefined &&
        current.expiresAt > now + channelRenewalLeadMs
      ) {
        continue;
      }

      const outcome = yield* renewGoogleChannel(
        repository,
        personId,
        resource,
        address,
        current
      ).pipe(Effect.result);

      if (Result.isFailure(outcome)) {
        const error = outcome.failure;

        if (unwatchable(resource, error)) {
          yield* maintenance.suppress(resource, error, now);
          yield* Effect.logWarning(
            "Google event watch rejected; cooldown recorded"
          ).pipe(
            Effect.annotateLogs({
              reason: error.reason ?? "unknown",
              resourceKind: resource.kind,
              status: error.status,
              until: now + unwatchableWindowMs,
            })
          );
        } else {
          failures.push(error);
        }
      }
    }

    const failure =
      failures.find(
        (error) =>
          Predicate.isTagged(error, "Provider") ||
          Predicate.isTagged(error, "RateLimited")
      ) ?? failures[0];

    if (failure !== undefined) {
      return yield* failure;
    }

    return yield* Effect.void;
  }
);
