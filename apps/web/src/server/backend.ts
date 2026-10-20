import { allowedEmail } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import { googleTokensFor } from "@calendar/auth/google-tokens";
import {
  CalendarReadFailure,
  createEvent,
  deleteEvent,
  getEvent,
  listCalendars,
  listEvents,
  rsvp,
  syncNow,
  updateEvent,
} from "@calendar/calendar";
import type {
  CalendarFailureValue,
  CalendarRefValue,
} from "@calendar/calendar";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { SessionUnavailable, sessionContract } from "@calendar/core/contracts";
import { Effect, Layer, Predicate } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { calendarForRequest } from "./calendar-runtime.js";
import type { CalendarBackendOptions } from "./calendar-runtime.js";

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
      const current = yield* Effect.tryPromise(
        auth.api.getSession.bind(auth.api, { headers })
      );

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
        syncNow.handler(input)
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
