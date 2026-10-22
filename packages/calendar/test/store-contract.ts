import { describe, expect, it } from "@effect/vitest";
import type { Vitest } from "@effect/vitest";
import { Clock, Effect, Layer, Predicate, Ref } from "effect";
import type { Scope } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { GoogleCalendarClient } from "../src/google.js";
import { CalendarStore } from "../src/store.js";
import { CalendarSync, syncCalendar } from "../src/sync.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";
import { runStoreHistory, StoreCommands } from "./store-history.js";
import type {
  StoreCommandValue,
  StoreObservationValue,
} from "./store-history.js";

const histories = Arbitrary.schema(StoreCommands);

export const calendarStoreContractWith = <E, R, HistoryError = never>(
  name: string,
  makeStoreLayer: () => Layer.Layer<CalendarStore, E, R>,
  options: {
    readonly effect: Vitest.Tester<R | Scope.Scope>;
    readonly history?: (
      commands: readonly StoreCommandValue[]
    ) => Effect.Effect<readonly StoreObservationValue[], HistoryError, R>;
  }
) =>
  describe(name, () => {
    const test = options.effect;

    test("a 5000-change sync commits only bounded cursor and version metadata", () =>
      Effect.gen(function* largeSyncMetadata() {
        const items = Array.from({ length: 5000 }, (_, index) =>
          timedEvent(`event-${index}`)
        );

        const fake = yield* fakeGoogle([
          response(200, {
            items: items.slice(0, 2500),
            nextPageToken: "second",
          }),
          response(200, { items: items.slice(2500), nextSyncToken: "large" }),
        ]);

        const published = yield* Ref.make<readonly CalendarChangedValue[]>([]);

        const signals = Layer.succeed(CalendarChanges, {
          publish: (change) =>
            Ref.update(published, (previous) => [...previous, change]),
        });

        const base = Layer.mergeAll(
          GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
          makeStoreLayer(),
          signals
        );

        const layer = CalendarSync.layer.pipe(Layer.provideMerge(base));
        yield* Effect.gen(function* verifyLargeSync() {
          const store = yield* CalendarStore;
          expect(yield* syncCalendar(ref)).toEqual({
            changed: 5000,
            cursor: "large",
            version: 1,
          });
          const large = yield* store.read(ref);
          expect(large).toEqual({ cursor: "large", revision: 1, version: 1 });
          expect(yield* Ref.get(published)).toEqual([
            { ...ref, reason: "sync", version: 1 },
          ]);
          yield* Ref.set(fake.pending, [
            response(200, {
              items: [timedEvent("one")],
              nextSyncToken: "small",
            }),
          ]);
          expect(yield* syncCalendar(ref)).toEqual({
            changed: 1,
            cursor: "small",
            version: 2,
          });
          const small = yield* store.read(ref);
          expect(small).toEqual({ cursor: "small", revision: 2, version: 2 });
          expect(JSON.stringify(large).length).toBe(
            JSON.stringify(small).length
          );
          expect(yield* Ref.get(fake.pending)).toEqual([]);
        }).pipe(Effect.provide(layer));
      }));
    test.prop(
      "only calendar changes invalidate ranges; every successful mutation publishes its version",
      { commands: histories },
      ({ commands }) =>
        Effect.gen(function* cacheHistory() {
          const clockMilliseconds = yield* Clock.currentTimeMillis;

          const observations = yield* options.history === undefined
            ? runStoreHistory(commands, makeStoreLayer)
            : options.history(commands);

          let cached = false;
          let version = 0;
          let revision = 0;
          let cursor: string | undefined;
          let requestCount = 0;
          const expectedChanges: CalendarChangedValue[] = [];

          for (const [index, observation] of observations.entries()) {
            const command = commands[index];

            expect(observation.command).toBe(command);

            if (Predicate.isTagged(observation, "Failed")) {
              expect(
                observation._tag,
                `${command} failed during ${observation.phase}: ${observation.cause}`
              ).toBe("Observed");
              continue;
            }

            expect(observation.clockMilliseconds).toBe(clockMilliseconds);

            if (command === "read") {
              if (!cached) {
                requestCount += 1;
              }

              expect(observation.listed?.versions).toEqual([
                { ...ref, version },
              ]);
              expect(
                observation.listed?.events.map((event) => event.eventId)
              ).toEqual(["event"]);
              expect(observation.synced).toBeUndefined();
              cached = true;
            } else if (command === "write") {
              version += 1;
              revision += 1;
              requestCount += 2;
              cached = false;
              expectedChanges.push({ ...ref, reason: "write", version });
              expect(observation.listed).toBeUndefined();
              expect(observation.synced).toBeUndefined();
            } else {
              const syncRequest = observation.requests[requestCount];

              const query = new URL(
                syncRequest?.path ?? "/",
                "https://fixture.test"
              ).searchParams;

              expect(query.get("syncToken")).toBe(cursor ?? null);
              cursor = `cursor-${index}`;
              revision += 1;
              requestCount += 1;

              if (command === "changedSync") {
                version += 1;
                cached = false;
                expectedChanges.push({ ...ref, reason: "sync", version });
              }

              expect(observation.synced).toEqual({
                changed: command === "emptySync" ? 0 : 1,
                cursor,
                version,
              });
              expect(observation.listed).toBeUndefined();
            }

            expect(observation.snapshot.cursor).toBe(cursor);
            expect(observation.snapshot.revision).toBe(revision);
            expect(observation.snapshot.version).toBe(version);
            expect(observation.published).toEqual(expectedChanges);
            expect(observation.requests).toHaveLength(requestCount);
            expect(observation.pending).toEqual([]);
          }

          expect(observations).toHaveLength(commands.length);
        })
    );

    test("an expired concurrent pull cannot clear a newer committed cursor", () =>
      Effect.gen(function* staleReset() {
        const fake = yield* fakeGoogle([response(410)]);

        const base = Layer.merge(
          GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
          makeStoreLayer()
        );

        const layer = CalendarSync.layer.pipe(Layer.provideMerge(base));
        yield* Effect.gen(function* runStaleReset() {
          const sync = yield* CalendarSync;
          const store = yield* CalendarStore;
          const failure = yield* sync.pull(ref).pipe(Effect.flip);
          expect(failure._tag).toBe("SyncExpired");
          expect(yield* store.commit(ref, 0, 0, "newer")).toBe(true);
          const error = yield* sync.reset(ref, 0).pipe(Effect.flip);
          expect(error._tag).toBe("Provider");
          expect((yield* store.read(ref)).cursor).toBe("newer");
        }).pipe(Effect.provide(layer));
      }));
  });

export const calendarStoreContract = <E>(
  name: string,
  makeStoreLayer: () => Layer.Layer<CalendarStore, E>
) => calendarStoreContractWith(name, makeStoreLayer, { effect: it.effect });
