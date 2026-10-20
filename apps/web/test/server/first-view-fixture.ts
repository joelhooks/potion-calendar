import { createFakeAuth } from "@calendar/auth/dev/fake-google";
import {
  ConnectedGoogleAccount,
  googleTokensFor,
} from "@calendar/auth/google-tokens";
import {
  CalendarService,
  CalendarStore,
  GoogleHttp,
  Provider,
} from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { Clock, Deferred, Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { seedFakePerson } from "../../src/dev/person.js";
import { calendarForPerson } from "../../src/server/calendar-runtime.js";

interface FirstViewState {
  readonly active: number;
  readonly peak: number;
  readonly started: readonly string[];
  readonly completed: readonly string[];
  readonly completedAtRange: readonly number[];
  readonly people: readonly string[];
}

interface FirstViewFault {
  readonly calendarId: string;
  readonly stage: "read" | "sync";
}

const fail = () =>
  new Provider({
    message: "Fixture first-view refusal",
    operation: "first-view",
    status: 403,
  });

const range = { end: "2026-10-26T00:00:00Z", start: "2026-10-19T00:00:00Z" };

export const firstViewFixture = Effect.fn("test.firstViewFixture")(
  function* firstViewFixture(
    count: number,
    cached: readonly number[] = [],
    fault?: FirstViewFault
  ) {
    const auth = createFakeAuth("http://calendar.test");
    const person = yield* seedFakePerson(auth, ["joel@example.test"]);

    const tokens = yield* googleTokensFor(
      auth.auth,
      person.personId,
      auth.config
    );

    const accounts = yield* tokens
      .accounts()
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.NonEmptyArray(ConnectedGoogleAccount)
          )
        )
      );

    const refs = Array.from({ length: count }, (_, index) => ({
      accountId: accounts[0].id,
      calendarId: `calendar-${index}`,
    }));

    const store = yield* CalendarStore.pipe(
      Effect.provide(memoryCalendarStore)
    );

    for (const index of cached) {
      const ref = refs[index];

      if (ref === undefined) {
        return yield* Effect.die(
          new Error("Invalid cached calendar fixture index")
        );
      }

      yield* store.commit(ref, 0, 0, "cached");
      yield* store.cacheRange(ref, range, 0, []);
    }

    const state = yield* Ref.make<FirstViewState>({
      active: 0,
      completed: [],
      completedAtRange: [],
      peak: 0,
      people: [],
      started: [],
    });

    const entered = yield* Deferred.make<boolean>();

    const observedStore = CalendarStore.of({
      ...store,
      read: (ref) =>
        fault?.stage === "read" && fault.calendarId === ref.calendarId
          ? Effect.fail(fail())
          : store.read(ref),
      readRange: (ref, selectedRange, version) =>
        Ref.update(state, (previous) => ({
          ...previous,
          completedAtRange: [
            ...previous.completedAtRange,
            previous.completed.length,
          ],
        })).pipe(Effect.andThen(store.readRange(ref, selectedRange, version))),
    });

    const program = calendarForPerson(
      auth.auth,
      auth.config,
      person.personId,
      {
        googleHttp: Layer.succeed(GoogleHttp, {
          execute: () =>
            Effect.die(
              new Error("First view must read the post-sync range cache")
            ),
        }),
        storeFor: () => Layer.succeed(CalendarStore, observedStore),
        synchronize: (personId, ref) =>
          Effect.acquireUseRelease(
            Ref.update(state, (previous) => ({
              ...previous,
              active: previous.active + 1,
              peak: Math.max(previous.peak, previous.active + 1),
              people: [...previous.people, personId],
              started: [...previous.started, ref.calendarId],
            })).pipe(Effect.andThen(Deferred.succeed(entered, true))),
            () =>
              Effect.gen(function* delayedSync() {
                yield* Effect.sleep(100);

                if (
                  fault?.stage === "sync" &&
                  fault.calendarId === ref.calendarId
                ) {
                  return yield* fail();
                }

                const before = yield* store.read(ref);
                yield* store.commit(ref, before.revision, 1, "synced");
                const after = yield* store.read(ref);
                yield* store.cacheRange(ref, range, after.version, []);
                yield* Ref.update(state, (previous) => ({
                  ...previous,
                  completed: [...previous.completed, ref.calendarId],
                }));

                return { changed: 1, cursor: "synced", version: after.version };
              }),
            () =>
              Ref.update(state, (previous) => ({
                ...previous,
                active: previous.active - 1,
              }))
          ),
      },
      refs,
      CalendarService.use((calendar) =>
        calendar.listEvents({ calendars: refs, range })
      )
    );

    const timed = Effect.gen(function* timedFirstView() {
      const started = yield* Clock.currentTimeMillis;
      const result = yield* program;

      return { elapsed: (yield* Clock.currentTimeMillis) - started, result };
    });

    return { entered, personId: person.personId, program, refs, state, timed };
  },
  Effect.provide(FetchHttpClient.layer)
);
