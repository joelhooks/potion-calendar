import { allowedEmail } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import { googleTokensFor, GoogleTokens } from "@calendar/auth/google-tokens";
import {
  CalendarChanges,
  ConferencingDefaults,
  CalendarReadFailure,
  CalendarService,
  CalendarSettings,
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
  CalendarFailureValue,
  SyncResultValue,
} from "@calendar/calendar";
import type { profileRepository } from "@calendar/database/profile";
import { BrowserCrypto } from "@effect/platform-browser";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { CalendarSynchronization } from "./calendar-synchronization.js";

export type CalendarRuntime =
  | CalendarService
  | CalendarSettings
  | CalendarSync
  | CalendarSynchronization
  | GoogleCalendarClient
  | GoogleHttp
  | GoogleTokens;

export interface CalendarBackendOptions {
  readonly tokenMode?: "refresh" | "cached-only";
  readonly saveProfile?: (
    personId: string,
    input: Parameters<ReturnType<typeof profileRepository>["save"]>[0]
  ) => ReturnType<ReturnType<typeof profileRepository>["save"]>;
  readonly deleteAccount?: (
    personId: string
  ) => Effect.Effect<void, CalendarFailureValue>;
  readonly storeFor: (personId: string) => Layer.Layer<CalendarStore>;
  readonly googleHttp?: Layer.Layer<GoogleHttp>;
  readonly settingsFor?: (
    personId: string
  ) => Effect.Effect<
    CalendarSettings["Service"],
    never,
    GoogleCalendarClient | CalendarStore
  >;
  readonly synchronize?: (
    personId: string,
    ref: CalendarRefValue
  ) => Effect.Effect<SyncResultValue, CalendarFailureValue>;
  readonly maintain?: (
    personId: string
  ) => Effect.Effect<void, CalendarFailureValue>;
  readonly changesFor?: (
    personId: string
  ) => NonNullable<CalendarBackendOptions["changes"]>;
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

const firstViewSyncConcurrency = 6;

export const calendarForPerson = <A, E>(
  auth: GoogleAuth,
  config: GoogleAuthConfig,
  personId: string,
  options: CalendarBackendOptions,
  refs: readonly CalendarRefValue[],
  operation: Effect.Effect<A, E, CalendarRuntime>
) =>
  Effect.gen(function* runCalendarForPerson() {
    const tokens = yield* googleTokensFor(
      auth,
      personId,
      config,
      options.tokenMode
    ).pipe(Effect.mapError(unavailable));

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
    const http = options.googleHttp ?? GoogleHttp.layer;

    const google = GoogleCalendarClient.layer.pipe(
      Layer.provide(BrowserCrypto.layer),
      Layer.provide(http),
      Layer.provide(tokenLayer)
    );

    const dependencies = Layer.mergeAll(
      google,
      http,
      tokenLayer,
      options.storeFor(personId),
      Layer.succeed(
        CalendarChanges,
        options.changesFor?.(personId) ??
          options.changes ?? { publish: () => Effect.void }
      )
    );

    const sync = CalendarSync.layer.pipe(Layer.provideMerge(dependencies));

    const coordination = Layer.effect(
      CalendarSynchronization,
      Effect.gen(function* synchronization() {
        const local = yield* CalendarSync;
        const { synchronize } = options;

        return CalendarSynchronization.of({
          run:
            synchronize === undefined
              ? (ref) =>
                  syncCalendar(ref).pipe(
                    Effect.provideService(CalendarSync, local)
                  )
              : (ref) => synchronize(personId, ref),
        });
      })
    ).pipe(Layer.provide(sync));

    const settings = Layer.effect(
      CalendarSettings,
      options.settingsFor?.(personId) ??
        Effect.succeed(
          CalendarSettings.of({
            disconnect: () => Effect.fail(unavailable()),
            getConferencingDefault: () => Effect.fail(unavailable()),
            importCustomVideoLinks: () => Effect.fail(unavailable()),
            readCustomVideoLinks: () => Effect.fail(unavailable()),
            removeCustomVideoLink: () => Effect.fail(unavailable()),
            resolveCustomVideoLink: () => Effect.fail(unavailable()),
            saveCustomVideoLink: () => Effect.fail(unavailable()),
            setAppearance: () => Effect.fail(unavailable()),
            setConferencingDefault: () => Effect.fail(unavailable()),
          })
        )
    ).pipe(Layer.provide(sync));

    const defaults = Layer.effect(
      ConferencingDefaults,
      CalendarSettings.use((accountSettings) =>
        Effect.succeed(
          ConferencingDefaults.of({
            forAccount: (accountId) =>
              accountSettings
                .getConferencingDefault({ accountId })
                .pipe(Effect.map((preference) => preference.value)),
            resolveCustomLink: (id) =>
              accountSettings.resolveCustomVideoLink(id),
          })
        )
      )
    ).pipe(Layer.provide(settings));

    const service = CalendarService.layer.pipe(
      Layer.provide(Layer.merge(sync, defaults))
    );

    const viewService = Layer.effect(
      CalendarService,
      Effect.gen(function* firstViewService() {
        const calendar = yield* CalendarService;
        const store = yield* CalendarStore;
        const synchronization = yield* CalendarSynchronization;

        return CalendarService.of({
          ...calendar,
          listEvents: Effect.fn("firstViewService.listEvents")(
            function* listEvents(input) {
              yield* Effect.forEach(
                input.calendars,
                (ref) =>
                  Effect.gen(function* firstViewSync() {
                    const snapshot = yield* store.read(ref);

                    if (snapshot.cursor === undefined) {
                      yield* synchronization.run(ref);
                    }
                  }).pipe(
                    Effect.mapError(
                      (cause) => new CalendarReadFailure({ ...ref, cause })
                    )
                  ),
                { concurrency: firstViewSyncConcurrency, discard: true }
              );

              return yield* calendar.listEvents(input);
            }
          ),
        });
      })
    ).pipe(Layer.provide(Layer.mergeAll(service, sync, coordination)));

    const services = Layer.mergeAll(viewService, sync, coordination, settings);

    return yield* operation.pipe(Effect.provide(services));
  }).pipe(Effect.provide(FetchHttpClient.layer));

export const calendarForRequest = <A, E>(
  auth: GoogleAuth,
  config: GoogleAuthConfig,
  headers: Headers,
  options: CalendarBackendOptions | undefined,
  refs: readonly CalendarRefValue[],
  operation: Effect.Effect<A, E, CalendarRuntime>
) =>
  Effect.gen(function* runCalendarForRequest() {
    const current = yield* Effect.tryPromise({
      catch: unavailable,

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => auth.api.getSession({ headers }),
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
