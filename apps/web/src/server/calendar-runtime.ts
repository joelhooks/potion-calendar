import { allowedEmail } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import { googleTokensFor, GoogleTokens } from "@calendar/auth/google-tokens";
import {
  CalendarChanges,
  CalendarReadFailure,
  CalendarService,
  CalendarStore,
  CalendarSync,
  GoogleCalendarClient,
  GoogleHttp,
  NotConnected,
  Provider,
  Revoked,
  syncCalendar,
} from "@calendar/calendar";
import type {
  CalendarChangedValue,
  CalendarRefValue,
} from "@calendar/calendar";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

export interface CalendarBackendOptions {
  readonly storeFor: (personId: string) => Layer.Layer<CalendarStore>;
  readonly googleHttp?: Layer.Layer<GoogleHttp>;
  readonly changes?: {
    readonly publish: (change: CalendarChangedValue) => Effect.Effect<void>;
  };
}

const unavailable = () =>
  new Provider({
    message: "Calendar backend is unavailable",
    operation: "calendar",
    status: 0,
  });

export const calendarForPerson = <A, E>(
  auth: GoogleAuth,
  config: GoogleAuthConfig,
  personId: string,
  options: CalendarBackendOptions,
  refs: readonly CalendarRefValue[],
  operation: Effect.Effect<A, E, CalendarService | CalendarSync>
) =>
  Effect.gen(function* runCalendarForPerson() {
    const tokens = yield* googleTokensFor(auth, personId, config).pipe(
      Effect.mapError(unavailable)
    );

    const accounts = yield* tokens
      .accounts()
      .pipe(Effect.mapError(unavailable));

    for (const ref of refs) {
      const account = accounts.find(
        (candidate) => candidate.id === ref.accountId
      );

      if (account === undefined) {
        return yield* new NotConnected({ accountId: ref.accountId });
      }

      if (account.disconnected) {
        return yield* new Revoked({ accountId: ref.accountId });
      }
    }

    const tokenLayer = Layer.succeed(GoogleTokens, tokens);

    const google = GoogleCalendarClient.layer.pipe(
      Layer.provide(options.googleHttp ?? GoogleHttp.layer),
      Layer.provide(tokenLayer)
    );

    const dependencies = Layer.mergeAll(
      google,
      tokenLayer,
      options.storeFor(personId),
      Layer.succeed(
        CalendarChanges,
        options.changes ?? { publish: () => Effect.void }
      )
    );

    const sync = CalendarSync.layer.pipe(Layer.provideMerge(dependencies));

    const service = CalendarService.layer.pipe(Layer.provide(sync));

    const viewService = Layer.effect(
      CalendarService,
      Effect.gen(function* firstViewService() {
        const calendar = yield* CalendarService;
        const store = yield* CalendarStore;
        const synchronization = yield* CalendarSync;

        return CalendarService.of({
          ...calendar,
          listEvents: Effect.fn("firstViewService.listEvents")(
            function* listEvents(input) {
              for (const ref of input.calendars) {
                yield* Effect.gen(function* firstViewSync() {
                  const snapshot = yield* store.read(ref);

                  if (snapshot.cursor === undefined) {
                    yield* syncCalendar(ref).pipe(
                      Effect.provideService(CalendarSync, synchronization)
                    );
                  }
                }).pipe(
                  Effect.mapError(
                    (cause) => new CalendarReadFailure({ ...ref, cause })
                  )
                );
              }

              return yield* calendar.listEvents(input);
            }
          ),
        });
      })
    ).pipe(Layer.provide(Layer.merge(service, sync)));

    const services = Layer.merge(viewService, sync);

    return yield* operation.pipe(Effect.provide(services));
  }).pipe(Effect.provide(FetchHttpClient.layer));

export const calendarForRequest = <A, E>(
  auth: GoogleAuth,
  config: GoogleAuthConfig,
  headers: Headers,
  options: CalendarBackendOptions | undefined,
  refs: readonly CalendarRefValue[],
  operation: Effect.Effect<A, E, CalendarService | CalendarSync>
) =>
  Effect.gen(function* runCalendarForRequest() {
    const current = yield* Effect.tryPromise({
      catch: unavailable,
      try: auth.api.getSession.bind(auth.api, { headers }),
    });

    if (
      current === null ||
      !allowedEmail(current.user.email, config.allowedEmails)
    ) {
      return yield* new NotConnected({ accountId: refs[0]?.accountId ?? "" });
    }

    if (options === undefined) {
      return yield* unavailable();
    }

    return yield* calendarForPerson(
      auth,
      config,
      current.user.id,
      options,
      refs,
      operation
    );
  });
