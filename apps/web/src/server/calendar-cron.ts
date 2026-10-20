import { authContext } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import { CalendarService, Provider, syncCalendar } from "@calendar/calendar";
import { Effect, Result, Schema } from "effect";

import { calendarForPerson } from "./calendar-runtime.js";
import type { CalendarBackendOptions } from "./calendar-runtime.js";

const People = Schema.Array(
  Schema.Struct({ email: Schema.String, id: Schema.String })
);

const cronFailure = () =>
  new Provider({
    message: "Calendar safety-net sync is unavailable",
    operation: "cron",
    status: 0,
  });

export const syncConnectedCalendars = Effect.fn("syncConnectedCalendars")(
  function* syncConnectedCalendars(
    auth: GoogleAuth,
    config: GoogleAuthConfig,
    options: CalendarBackendOptions
  ) {
    const context = yield* authContext(auth);

    const emails = [
      ...new Set(
        config.allowedEmails
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];

    if (emails.length === 0) {
      return { failed: 0, people: 0, synced: 0 };
    }

    const rows = yield* Effect.tryPromise({
      catch: cronFailure,
      try: context.adapter.findMany.bind(context.adapter, {
        limit: emails.length,
        model: "user",
        where: [{ field: "email", operator: "in", value: emails }],
      }),
    });

    const people = yield* Schema.decodeUnknownEffect(People)(rows).pipe(
      Effect.mapError(cronFailure)
    );

    let synced = 0;
    let failed = 0;

    for (const person of people) {
      const outcome = yield* calendarForPerson(
        auth,
        config,
        person.id,
        options,
        [],
        Effect.gen(function* syncPerson() {
          const service = yield* CalendarService;
          const listing = yield* service.listCalendars();
          let completed = 0;
          let failures = 0;

          for (const account of listing.accounts) {
            if ("failure" in account) {
              failures += 1;

              continue;
            }

            for (const calendar of account.calendars) {
              const result = yield* Effect.result(syncCalendar(calendar));

              if (Result.isSuccess(result)) {
                completed += 1;
              } else {
                failures += 1;
              }
            }
          }

          return { completed, failures };
        })
      ).pipe(Effect.result);

      if (Result.isSuccess(outcome)) {
        synced += outcome.success.completed;
        failed += outcome.success.failures;
      } else {
        failed += 1;
      }
    }

    return { failed, people: people.length, synced };
  }
);
