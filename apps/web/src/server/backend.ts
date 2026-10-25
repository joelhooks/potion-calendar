import {
  allowedEmail,
  accountDeletionProof,
  profileUpdateProof,
} from "@calendar/auth/google";
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
import {
  SessionUnavailable,
  sessionContract,
  deleteAccountContract,
  saveProfileContract,
} from "@calendar/core/contracts";
import { Cause, Effect, Layer, Option, Predicate, Schema } from "effect";
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
import { deleteCurrentAccount } from "./delete-account-rpc.js";
import { saveCurrentProfile } from "./profile-rpc.js";

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

      const primary = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          primaryCalendarAccountId: Schema.optional(
            Schema.NullOr(Schema.String)
          ),
        })
      )(current.user);

      const user = {
        email: current.user.email,
        id: current.user.id,
        name: current.user.name,
        primaryAccountId: primary.primaryCalendarAccountId ?? null,
      };

      const image = Schema.decodeUnknownOption(Schema.String)(
        current.user.image
      );

      return {
        accountDeletionProof: yield* accountDeletionProof(
          config.secret,
          current.session.token
        ),
        accounts: yield* tokens.accounts(),
        profileUpdateProof: yield* profileUpdateProof(
          config.secret,
          current.session.token
        ),
        user: Option.match(image, {
          onNone: () => user,
          onSome: (value) => ({ ...user, image: value }),
        }),
      };
    }).pipe(Effect.mapError(() => new SessionUnavailable()))
  );

  const committedCookies = new Headers();

  const rpc = toRpc([
    session,
    implement(saveProfileContract, (input) =>
      saveCurrentProfile(auth, config, headers, input, options?.saveProfile)
    ),
    implement(deleteAccountContract, (input) =>
      deleteCurrentAccount(
        auth,
        config,
        headers,
        input.proof,
        options?.deleteAccount,
        committedCookies
      )
    ),
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

  const router = HttpRouter.toWebHandler(
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

  return {
    ...router,
    // @effect-diagnostics-next-line asyncFunction:off -- The non-framed JSON RPC projection finishes its handlers before this native HTTP response is returned.
    handler: async (...args: Parameters<typeof router.handler>) => {
      const response = await router.handler(...args);

      const status =
        committedCookies.get("x-calendar-deletion-status") === "409"
          ? 409
          : response.status;

      const cookies = committedCookies.getSetCookie();
      committedCookies.delete("x-calendar-deletion-status");
      committedCookies.delete("set-cookie");

      if (cookies.length === 0 && status === response.status) {
        return response;
      }

      const responseHeaders = new Headers(response.headers);

      for (const cookie of cookies) {
        responseHeaders.append("set-cookie", cookie);
      }

      return new Response(response.body, { headers: responseHeaders, status });
    },
  };
};
