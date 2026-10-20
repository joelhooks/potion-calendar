import { expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { CalendarService } from "../src/calendar.js";
import { GoogleTokens } from "../src/google-tokens.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import type { CalendarEventValue, CalendarRefValue } from "../src/model.js";
import { CalendarStore } from "../src/store.js";
import { GoogleHttp } from "../src/transport.js";
import type { GoogleRequestValue, GoogleResponse } from "../src/transport.js";
import {
  fakeConferencingDefaults,
  fakeGoogleCrypto,
  response,
  timedEvent,
} from "./fake-google.js";

const range = { end: "2026-04-01T00:00:00Z", start: "2026-03-01T00:00:00Z" };

const calendars = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    accountId: `account-${index % 2}`,
    calendarId: `calendar-${index}`,
  }));

const events = (
  ref: CalendarRefValue,
  index: number
): readonly CalendarEventValue[] =>
  ["a", "b"].map((suffix) => ({
    ...ref,
    eventId: `event-${index}-${suffix}`,
    status: "confirmed",
  }));

const page = (index: number) =>
  response(200, {
    items: [
      timedEvent(`event-${index}-a`),
      timedEvent(`event-${index}-cancelled`, "Cancelled", {
        status: "cancelled",
      }),
      timedEvent(`event-${index}-b`),
    ],
  });

const delayedGoogle = Effect.fn("delayedGoogle")(function* delayedGoogle(
  refs: readonly CalendarRefValue[],
  delays: readonly number[],
  respond: (index: number, url: URL) => GoogleResponse = page,
  storeLayer: Layer.Layer<CalendarStore> = memoryCalendarStore
) {
  const state = yield* Ref.make<{
    readonly active: number;
    readonly peak: number;
    readonly started: readonly number[];
    readonly completed: readonly number[];
    readonly paths: readonly string[];
  }>({ active: 0, completed: [], paths: [], peak: 0, started: [] });

  const http = Layer.succeed(GoogleHttp, {
    execute: Effect.fn("delayedGoogle.execute")(function* execute(
      request: GoogleRequestValue
    ) {
      const url = new URL(`https://fake.test${request.path}`);

      const index = refs.findIndex(
        (ref) =>
          url.pathname ===
          `/calendars/${encodeURIComponent(ref.calendarId)}/events`
      );

      if (index === -1) {
        return yield* Effect.die(
          new Error(`Unexpected request ${request.path}`)
        );
      }

      return yield* Effect.acquireUseRelease(
        Ref.update(state, (previous) => ({
          ...previous,
          active: previous.active + 1,
          paths: [...previous.paths, request.path],
          peak: Math.max(previous.peak, previous.active + 1),
          started: [...previous.started, index],
        })),
        () =>
          Effect.sleep(delays[index] ?? 0).pipe(
            Effect.tap(() =>
              Ref.update(state, (previous) => ({
                ...previous,
                completed: [...previous.completed, index],
              }))
            ),
            Effect.as(respond(index, url))
          ),
        () =>
          Ref.update(state, (previous) => ({
            ...previous,
            active: previous.active - 1,
          }))
      );
    }),
  });

  const tokens = Layer.succeed(GoogleTokens, {
    accessToken: () => Effect.succeed(Redacted.make("test-token")),
    accounts: () => Effect.succeed([]),
  });

  const base = Layer.mergeAll(
    http,
    tokens,
    storeLayer,
    fakeGoogleCrypto,
    fakeConferencingDefaults
  );

  const layer = CalendarService.layer.pipe(
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(Layer.provideMerge(base))
    )
  );

  return { layer, state };
});

const timedRead = Effect.fn("timedRead")(function* timedRead(
  refs: readonly CalendarRefValue[]
) {
  const started = yield* Clock.currentTimeMillis;

  const result = yield* CalendarService.use((calendar) =>
    calendar.listEvents({ calendars: refs, range })
  );

  return { elapsed: (yield* Clock.currentTimeMillis) - started, result };
});

it.effect("six cold calendars finish in one provider delay, not six", () =>
  Effect.gen(function* parallelRange() {
    const refs = calendars(6);

    const fake = yield* delayedGoogle(
      refs,
      refs.map(() => 100)
    );

    const fiber = yield* timedRead(refs).pipe(
      Effect.provide(fake.layer),
      Effect.forkChild
    );

    yield* TestClock.adjust(100);
    const state = yield* Ref.get(fake.state);
    expect(state.completed).toHaveLength(6);
    expect(state.peak).toBe(6);
    const { result, elapsed } = yield* Fiber.join(fiber);
    expect(elapsed).toBe(100);
    expect(result.events.map((event) => event.eventId)).toEqual(
      refs.flatMap((ref, index) =>
        events(ref, index).map((event) => event.eventId)
      )
    );
    expect(result.versions).toEqual(
      refs.map((ref) => ({ ...ref, version: 0 }))
    );

    for (const path of state.paths) {
      const url = new URL(`https://fake.test${path}`);
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("timeMin")).toBe(range.start);
      expect(url.searchParams.get("timeMax")).toBe(range.end);
    }
  })
);

it.effect.prop(
  "additional calendars never exceed six in-flight provider requests",
  { count: Schema.Int.check(Schema.isBetween({ maximum: 18, minimum: 7 })) },
  ({ count }) =>
    Effect.gen(function* boundedRanges() {
      const refs = calendars(count);

      const fake = yield* delayedGoogle(
        refs,
        refs.map(() => 100)
      );

      const fiber = yield* timedRead(refs).pipe(
        Effect.provide(fake.layer),
        Effect.forkChild
      );

      yield* TestClock.adjust((count + 1) * 100);
      const state = yield* Ref.get(fake.state);
      expect(state.completed).toHaveLength(count);
      expect(state.peak).toBe(6);
      expect(state.active).toBe(0);
      yield* Fiber.join(fiber);
    })
);

it.effect.prop(
  "out-of-order snapshots and provider completions preserve event and version input order, including cache hits",
  { cacheHits: Schema.Boolean },
  ({ cacheHits }) =>
    Effect.gen(function* orderedRanges() {
      const refs = calendars(6);

      const delayedStore = Layer.effect(
        CalendarStore,
        Effect.gen(function* delaySnapshots() {
          const store = yield* CalendarStore;

          return CalendarStore.of({
            ...store,
            read: (ref) =>
              Effect.sleep(
                (refs.length -
                  refs.findIndex(
                    (candidate) => candidate.calendarId === ref.calendarId
                  )) *
                  10
              ).pipe(Effect.andThen(store.read(ref))),
          });
        })
      ).pipe(Layer.provide(memoryCalendarStore));

      const fake = yield* delayedGoogle(
        refs,
        refs.map((_, index) => (refs.length - index) * 10),
        page,
        delayedStore
      );

      const fiber = yield* Effect.gen(function* fillAndRead() {
        const store = yield* CalendarStore;

        for (const [index, ref] of refs.entries()) {
          for (let version = 0; version <= index; version += 1) {
            yield* store.invalidate(ref);
          }

          if (cacheHits && index % 2 === 1) {
            expect(
              yield* store.cacheRange(ref, range, index + 1, events(ref, index))
            ).toBe(true);
          }
        }

        return yield* CalendarService.use((calendar) =>
          calendar.listEvents({ calendars: refs, range })
        );
      }).pipe(Effect.provide(fake.layer), Effect.forkChild);

      yield* TestClock.adjust(200);
      const result = yield* Fiber.join(fiber);
      const state = yield* Ref.get(fake.state);
      expect(state.completed).toEqual(
        refs
          .map((_, index) => index)
          .filter((index) => !cacheHits || index % 2 === 0)
          .toReversed()
      );
      expect(
        result.events.map((event) => [event.calendarId, event.eventId])
      ).toEqual(
        refs.flatMap((ref, index) =>
          events(ref, index).map((event) => [event.calendarId, event.eventId])
        )
      );
      expect(result.versions).toEqual(
        refs.map((ref, index) => ({ ...ref, version: index + 1 }))
      );
    })
);

it.effect.prop(
  "a failed calendar still fails the whole read with its own identity and cause",
  { failed: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 })) },
  ({ failed }) =>
    Effect.gen(function* failedRange() {
      const refs = calendars(6);

      const fake = yield* delayedGoogle(
        refs,
        refs.map((_, index) => {
          if (index === failed) {
            return 20;
          }

          return index % 2 === 0 ? 10 : 100;
        }),
        (index) => (index === failed ? response(404) : page(index))
      );

      const fiber = yield* timedRead(refs).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
        Effect.forkChild
      );

      yield* TestClock.adjust(30);
      const failure = yield* Fiber.join(fiber);
      expect(failure.accountId).toBe(refs[failed]?.accountId);
      expect(failure.calendarId).toBe(refs[failed]?.calendarId);
      expect(failure.cause._tag).toBe("NotFound");
      const state = yield* Ref.get(fake.state);
      expect(state.active).toBe(0);
      expect(state.completed.length).toBeLessThan(refs.length);
    })
);
