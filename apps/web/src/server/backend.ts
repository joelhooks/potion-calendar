import { allowedEmail } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import { googleTokensFor } from "@calendar/auth/google-tokens";
import {
  CalendarReadFailure,
  createEvent,
  deleteEvent,
  disconnectAccount,
  getAccountConferencingDefault,
  setAccountConferencingDefault,
  setCalendarAppearance,
  getEvent,
  readNeighborOccurrence,
  listCalendars,
  listEvents,
  moveAndRetimeSeries,
  moveEvent,
  rsvp,
  searchEvents,
  syncNow,
  updateEvent,
} from "@calendar/calendar";
import type {
  CalendarFailureValue,
  CalendarRefValue,
  CalendarValue,
} from "@calendar/calendar";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { SessionUnavailable, sessionContract } from "@calendar/core/contracts";
import { Cause, Effect, Layer, Predicate } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import {
  SearchInventoryUnavailable,
  searchEventsContract,
} from "../search-contract.js";
import type { SearchAccountFailure } from "../search-contract.js";
import { calendarForRequest } from "./calendar-runtime.js";
import type { CalendarBackendOptions } from "./calendar-runtime.js";
import { CalendarSynchronization } from "./calendar-synchronization.js";

const readFailureFor = (
  refs: readonly CalendarRefValue[],
  error: CalendarReadFailure | CalendarFailureValue
) => {
  if (Predicate.isTagged(error, "CalendarReadFailure")) {
    return error;
  }

  const ref =
    refs.find(
      (candidate) =>
        "accountId" in error && candidate.accountId === error.accountId
    ) ?? refs[0];

  return new CalendarReadFailure({
    accountId: ref?.accountId ?? "",
    calendarId: ref?.calendarId ?? "",
    cause: error,
  });
};

export const createBackend = (
  auth: GoogleAuth,
  config: GoogleAuthConfig,
  headers: Headers,
  options?: CalendarBackendOptions
) => {
  const session = implement(sessionContract, () =>
    Effect.gen(function* readSession() {
      const current = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => auth.api.getSession({ headers }),
      });

      if (!current || !allowedEmail(current.user.email, config.allowedEmails)) {
        return null;
      }

      const tokens = yield* googleTokensFor(auth, current.user.id, config);

      return {
        accounts: yield* tokens.accounts(),
        user: {
          email: current.user.email,
          id: current.user.id,
          name: current.user.name,
        },
      };
    }).pipe(Effect.mapError(() => new SessionUnavailable()))
  );

  const rpc = toRpc([
    session,
    implement(getAccountConferencingDefault.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [],
        getAccountConferencingDefault.handler(input)
      )
    ),
    implement(setAccountConferencingDefault.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [],
        setAccountConferencingDefault.handler(input)
      )
    ),
    implement(disconnectAccount.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [],
        disconnectAccount.handler(input)
      )
    ),
    implement(setCalendarAppearance.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        setCalendarAppearance.handler(input)
      )
    ),
    implement(listCalendars.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [],
        listCalendars.handler(input)
      )
    ),
    implement(listEvents.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        input.calendars,
        listEvents.handler(input)
      ).pipe(Effect.mapError(readFailureFor.bind(undefined, input.calendars)))
    ),
    implement(getEvent.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        getEvent.handler(input)
      ).pipe(Effect.mapError(readFailureFor.bind(undefined, [input])))
    ),
    implement(readNeighborOccurrence.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        readNeighborOccurrence.handler(input)
      ).pipe(Effect.mapError(readFailureFor.bind(undefined, [input])))
    ),
    implement(createEvent.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        createEvent.handler(input)
      )
    ),
    implement(updateEvent.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        updateEvent.handler(input)
      )
    ),
    implement(searchEventsContract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [],
        Effect.gen(function* searchPersonInventory() {
          if (input.query.trim() === "") {
            return {
              ...(yield* searchEvents.handler({ ...input, calendars: [] })),
              accountFailures: [],
            };
          }

          const inventory = yield* listCalendars.handler({});
          const calendars: CalendarValue[] = [];
          const accountFailures: (typeof SearchAccountFailure.Type)[] = [];
          let loaded = 0;

          for (const account of inventory.accounts) {
            if ("failure" in account) {
              accountFailures.push({
                accountId: account.accountId,
                failure: account.failure,
              });
            } else {
              loaded += 1;
              calendars.push(...account.calendars);
            }
          }

          if (loaded === 0) {
            return yield* new SearchInventoryUnavailable({
              accountFailures,
              reason:
                inventory.accounts.length === 0
                  ? "noAccounts"
                  : "allInventoriesFailed",
            });
          }

          const unavailableAccounts = new Map(
            accountFailures.map((failure) => [
              failure.accountId,
              failure.failure,
            ])
          );

          const continuation =
            input.continuation === undefined
              ? undefined
              : {
                  ...input.continuation,
                  pages: input.continuation.pages.filter(
                    (page) => !unavailableAccounts.has(page.accountId)
                  ),
                };

          const unavailablePages =
            input.continuation?.pages.flatMap((page) => {
              const cause = unavailableAccounts.get(page.accountId);

              return cause === undefined
                ? []
                : [
                    new CalendarReadFailure({
                      accountId: page.accountId,
                      calendarId: page.calendarId,
                      cause,
                    }),
                  ];
            }) ?? [];

          const searched = yield* searchEvents.handler({
            ...input,
            calendars,
            continuation,
          });

          return {
            ...searched,
            accountFailures,
            failures: [...searched.failures, ...unavailablePages],
          };
        })
      )
    ),
    implement(moveAndRetimeSeries.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input, input.destination],
        moveAndRetimeSeries.handler(input)
      )
    ),
    implement(moveEvent.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input, input.destination],
        moveEvent.handler(input)
      )
    ),
    implement(deleteEvent.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        deleteEvent.handler(input)
      )
    ),
    implement(rsvp.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        rsvp.handler(input)
      )
    ),
    implement(syncNow.contract, (input) =>
      calendarForRequest(
        auth,
        config,
        headers,
        options,
        [input],
        CalendarSynchronization.use((synchronization) =>
          synchronization.run(input)
        )
      )
    ),
  ]);

  return HttpRouter.toWebHandler(
    RpcServer.layerHttp({
      group: rpc.group,
      path: "/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide(rpc.layer),
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer)
    ),
    { disableLogger: true }
  );
};
